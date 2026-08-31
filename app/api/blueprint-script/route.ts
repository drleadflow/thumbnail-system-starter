// Blueprint → Interview → Probe → Assembled script (draft + craft pass).
//   POST { blueprintId, topic, mode: "interview" }
//       → { questions: ["..."] }  — 5-8 targeted questions from the blueprint's
//                                   placeholders + profile gaps
//   POST { blueprintId, topic, mode: "probe", qa: [{q, a}] }
//       → { followups: ["..."] }  — up to 4 digging questions for answers too
//                                   thin to write from (empty = rich enough)
//   POST { blueprintId, topic, title?, qa: [{q, a}] }
//       → { scriptId, title }     — two-stage: draft into the structure, then a
//                                   craft pass that rewrites for spoken
//                                   storytelling and flags [THIN: …] honestly.
//                                   Grounded on the blueprint's own source
//                                   transcripts as MECHANIC exemplars (pacing,
//                                   specificity) — never their words.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 300;

interface Beat { name: string; purpose: string; instruction: string; placeholder: string }

// TITLE/HOOK/SCRIPT delimited output — long markdown scripts routinely break
// JSON string escaping, so the assembly stages don't use JSON at all.
function parseScriptOutput(raw: string): { title: string; hook: string; script: string } | null {
  const t = raw.match(/TITLE:\s*(.+)/);
  const h = raw.match(/HOOK:\s*([\s\S]*?)\nSCRIPT:/);
  const sc = raw.match(/SCRIPT:\s*\n([\s\S]+)/);
  if (!sc) return null;
  return { title: (t?.[1] || "").trim(), hook: (h?.[1] || "").trim(), script: sc[1].trim() };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const blueprintId = String(body.blueprintId || "").trim();
  const topic = String(body.topic || "").trim();
  if (!blueprintId || !topic) return NextResponse.json({ error: "Pick a blueprint and give a topic." }, { status: 400 });
  const d = db();
  const { data: bp } = await d.from("blueprints").select("*").eq("id", blueprintId).single();
  if (!bp) return NextResponse.json({ error: "Blueprint not found." }, { status: 404 });
  const beats: Beat[] = Array.isArray(bp.beats) ? bp.beats : [];
  const pBlock = await profileBlock();

  // ── Stage 1: the interview ──
  if (body.mode === "interview") {
    const prompt = [
      pBlock,
      `The creator is about to write a video on: "${topic}", using the "${bp.name}" structure (${bp.description}).`,
      "The structure's beats and what each needs from the creator:",
      ...beats.map((b, i) => `${i + 1}. ${b.name} (${b.purpose}): needs ${b.placeholder}`),
      "",
      "Write the SHORTEST interview that extracts everything the beats need that only the creator can supply: their real numbers, their real story, their specific examples, their opinion, their call to action. Rules:",
      "- 5-8 questions, each one line, plain spoken language, no compound questions.",
      "- Only ask for things the AI could NOT invent — never ask things the profile already answers.",
      "- Order them so answering feels like telling the story.",
      'Return ONLY a raw JSON array of question strings.',
    ].filter(Boolean).join("\n");
    try {
      const raw = await llm(prompt, 800);
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) return NextResponse.json({ error: "Interview generation failed — try again." }, { status: 502 });
      const questions = (JSON.parse(m[0]) as unknown[]).map((q) => String(q).slice(0, 300)).filter(Boolean).slice(0, 8);
      return NextResponse.json({ ok: true, questions });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "interview failed" }, { status: 502 });
    }
  }

  const qa: { q: string; a: string }[] = (Array.isArray(body.qa) ? body.qa : [])
    .map((x: { q?: unknown; a?: unknown }) => ({ q: String(x.q || "").slice(0, 300), a: String(x.a || "").slice(0, 3000) }))
    .filter((x: { q: string; a: string }) => x.q && x.a.trim());
  if (!qa.length) return NextResponse.json({ error: "Answer at least one interview question first." }, { status: 400 });

  // ── Stage 1.5: the probe — dig where answers are too thin to write from ──
  if (body.mode === "probe") {
    const prompt = [
      `A creator answered an interview for a video on "${topic}" (structure: ${bp.name}). Their answers, verbatim:`,
      ...qa.map((x) => `Q: ${x.q}\nA: ${x.a}`),
      "",
      "A script written ONLY from these answers will be flat wherever an answer lacks a concrete story, number, or example. Find the answers too thin to write a compelling beat from, and ask up to 4 SHORT follow-up questions that dig for the missing material:",
      "- Ask for the story behind a claim (what happened, what broke, what it cost).",
      "- Ask for the specific number, timeframe, or before/after.",
      "- One line each, spoken language, no compound questions.",
      "- If every answer already has story + specifics, return [].",
      'Return ONLY a raw JSON array of question strings.',
    ].join("\n");
    try {
      const raw = await llm(prompt, 600);
      const m = raw.match(/\[[\s\S]*\]/);
      const followups = m ? (JSON.parse(m[0]) as unknown[]).map((q) => String(q).slice(0, 300)).filter(Boolean).slice(0, 4) : [];
      return NextResponse.json({ ok: true, followups });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "probe failed" }, { status: 502 });
    }
  }

  // ── Stage 2: assembly (draft into structure) + craft pass ──
  const { data: voiceRows } = await d.from("scripts").select("voice_transcript").neq("voice_transcript", "").order("created_at", { ascending: false }).limit(3);
  const voice = (voiceRows || []) as { voice_transcript: string }[];

  // Mechanic exemplars: the transcripts this blueprint was distilled from —
  // already cached in video_hooks. Pacing/specificity reference only.
  const refIds = (Array.isArray(bp.source_refs) ? bp.source_refs : [])
    .filter((r: { type?: string; id?: string }) => r?.type === "video" && r?.id).map((r: { id: string }) => r.id).slice(0, 2);
  const exemplars: string[] = [];
  for (const vid of refIds) {
    const { data: h } = await d.from("video_hooks").select("full_transcript, title").eq("video_id", vid).single();
    if (h?.full_transcript) exemplars.push(`EXEMPLAR ("${h.title}"):\n${String(h.full_transcript).slice(0, 4000)}`);
  }

  const prompt = [
    pBlock,
    `Write a YouTube script for the video "${body.title || topic}" (topic: ${topic}) INTO this exact structure — the "${bp.name}" blueprint:`,
    ...beats.map((b, i) => `${i + 1}. ${b.name} (${b.purpose}) — ${b.instruction}. Needs: ${b.placeholder}`),
    "",
    "THE CREATOR'S OWN MATERIAL (from their interview — this is the ONLY source of facts, numbers, stories and claims):",
    ...qa.map((x) => `Q: ${x.q}\nA: ${x.a}`),
    voice.length ? "\nHOW THE CREATOR ACTUALLY TALKS (match this register):\n" + voice.map((v) => `- ${String(v.voice_transcript).slice(0, 800)}`).join("\n") : "",
    exemplars.length ? "\nMECHANIC EXEMPLARS — for RHYTHM AND PACING ONLY. Study how they vary line length, open loops, and turn claims into moments. ANY fact, tool name, number, concept, or piece of subject matter that appears in an exemplar but NOT in the interview is FORBIDDEN in your output — if you catch yourself explaining something the creator never said, delete it and put a [YOUR ...: description] placeholder instead:\n" + exemplars.map((e) => e.slice(0, 2500)).join("\n\n") : "",
    "",
    "RULES:",
    "- Every fact, number, story and claim comes from the interview answers. Where a beat needs something they didn't supply, put a [YOUR ...: description] placeholder — never invent, never fill from general knowledge, never borrow subject matter from the exemplars.",
    "- Never change what a number refers to: if the creator said 15 agents, it is 15 agents — not 15 clients, tools, or anything else.",
    "- Their phrasing survives: where an answer is quotable, use their words.",
    "- Written to be SPOKEN — plain, direct, first person. No hype words, no 'in this video'.",
    "- PEAK-READABILITY FORMAT (teleprompter-clean): one idea per line. Short lines, broken at natural breath points. **Bold** the punch words. Each beat is a `## Beat name · ~M:SS` section (estimate timestamps at 150 words/min). End each section with a blank line.",
    "- Total length: whatever the material honestly supports — do not pad.",
    "",
    "Return EXACTLY this format (no JSON, no code fences):",
    "TITLE: the working title",
    "HOOK: the first 1-3 spoken sentences",
    "SCRIPT:",
    "the full markdown script in the format above",
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 4000);
    const parsed = parseScriptOutput(raw);
    if (!parsed) return NextResponse.json({ error: "Assembly returned nothing usable — try again." }, { status: 502 });
    let out: { title: string; hook: string; script: string } = parsed;

    // ── Craft pass: rewrite the draft for spoken storytelling, flag thin spots ──
    // Same integrity contract: interview = only source of facts; honest flags
    // beat papered-over gaps. If this pass fails, ship the stage-1 draft.
    try {
      const craftPrompt = [
        "You are a ruthless script editor for spoken YouTube delivery. Below is a draft script and the creator's interview (the ONLY permitted source of facts).",
        "",
        "DRAFT:\n" + String(out.script || ""),
        "",
        "INTERVIEW (only source of truth):\n" + qa.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n"),
        voice.length ? "\nTHE CREATOR'S REGISTER:\n" + voice.map((v) => `- ${String(v.voice_transcript).slice(0, 600)}`).join("\n") : "",
        "",
        "Rewrite every beat for spoken storytelling:",
        "- Turn claims into moments: where the interview has a story or number, make the beat live inside it (what happened, then the lesson) instead of stating the conclusion.",
        "- Vary rhythm: a long line, then a short punch. Add ONE open loop early that pays off later — using only interview material.",
        "- Where a beat has no real material, do NOT pad it. Mark it honestly: a single line `[THIN: what the creator should add — e.g. the story of the week this broke]`.",
        "- Keep the creator's phrasing where it's quotable. Keep the teleprompter format exactly: one idea per line, **bold** punch words, `## Beat · ~M:SS` sections, blank line after each.",
        "- Never invent a fact, number, name, or story. The [YOUR ...: ...] placeholders stay if their material never arrived.",
        "- INTEGRITY SWEEP: go claim by claim through your rewrite. Any tool name, statistic, timeframe, or workflow detail that is not in the interview gets deleted or replaced with [YOUR ...: description] / [THIN: ...]. Never change what a number refers to.",
        "",
        "Return EXACTLY this format (no JSON, no code fences):",
        "TITLE: ...",
        "HOOK: the first 1-3 spoken sentences",
        "SCRIPT:",
        "the full rewritten markdown script",
      ].join("\n");
      const craftRaw = await llm(craftPrompt, 4000);
      const crafted = parseScriptOutput(craftRaw);
      if (crafted && crafted.script.length > 200) out = { title: crafted.title || out.title, hook: crafted.hook || out.hook, script: crafted.script };
    } catch { /* stage-1 draft is still a valid result */ }
    const { data: row, error } = await d.from("scripts").insert({
      title: String(out.title || body.title || topic).slice(0, 300),
      topic: topic.slice(0, 200),
      hook: String(out.hook || "").slice(0, 2000),
      content: String(out.script || "").slice(0, 200_000) + `\n\n---\n## Interview notes\n${qa.map((x) => `**${x.q}**\n${x.a}`).join("\n\n")}`,
      source: "blueprint",
      blueprint_id: blueprintId,
    }).select("id, title").single();
    if (error) throw new Error(error.message);
    await d.from("blueprints").update({ uses: (Number(bp.uses) || 0) + 1 }).eq("id", blueprintId);
    return NextResponse.json({ ok: true, scriptId: row.id, title: row.title });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "assembly failed" }, { status: 502 });
  }
}
