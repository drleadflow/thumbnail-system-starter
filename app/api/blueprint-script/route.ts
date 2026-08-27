// Blueprint → Interview → Assembled script.
//   POST { blueprintId, topic, mode: "interview" }
//       → { questions: ["..."] }  — 5-8 targeted questions from the blueprint's
//                                   placeholders + profile gaps
//   POST { blueprintId, topic, title?, qa: [{q, a}] }
//       → { scriptId, title }     — draft written INTO the structure, readability-
//                                   formatted for spoken delivery, saved as a script
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 300;

interface Beat { name: string; purpose: string; instruction: string; placeholder: string }

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

  // ── Stage 2: assembly + readability pass ──
  const qa: { q: string; a: string }[] = (Array.isArray(body.qa) ? body.qa : [])
    .map((x: { q?: unknown; a?: unknown }) => ({ q: String(x.q || "").slice(0, 300), a: String(x.a || "").slice(0, 3000) }))
    .filter((x: { q: string; a: string }) => x.q && x.a.trim());
  if (!qa.length) return NextResponse.json({ error: "Answer at least one interview question first." }, { status: 400 });

  const { data: voiceRows } = await d.from("scripts").select("voice_transcript").neq("voice_transcript", "").order("created_at", { ascending: false }).limit(3);
  const voice = (voiceRows || []) as { voice_transcript: string }[];

  const prompt = [
    pBlock,
    `Write a YouTube script for the video "${body.title || topic}" (topic: ${topic}) INTO this exact structure — the "${bp.name}" blueprint:`,
    ...beats.map((b, i) => `${i + 1}. ${b.name} (${b.purpose}) — ${b.instruction}. Needs: ${b.placeholder}`),
    "",
    "THE CREATOR'S OWN MATERIAL (from their interview — this is the ONLY source of facts, numbers, stories and claims):",
    ...qa.map((x) => `Q: ${x.q}\nA: ${x.a}`),
    voice.length ? "\nHOW THE CREATOR ACTUALLY TALKS (match this register):\n" + voice.map((v) => `- ${String(v.voice_transcript).slice(0, 800)}`).join("\n") : "",
    "",
    "RULES:",
    "- Every fact, number, story and claim comes from the interview answers. Where a beat needs something they didn't supply, put a [YOUR ...: description] placeholder — never invent.",
    "- Their phrasing survives: where an answer is quotable, use their words.",
    "- Written to be SPOKEN — plain, direct, first person. No hype words, no 'in this video'.",
    "- PEAK-READABILITY FORMAT (teleprompter-clean): one idea per line. Short lines, broken at natural breath points. **Bold** the punch words. Each beat is a `## Beat name · ~M:SS` section (estimate timestamps at 150 words/min). End each section with a blank line.",
    "- Total length: whatever the material honestly supports — do not pad.",
    "",
    'Return ONLY raw JSON: {"title":"the working title","hook":"the first 1-3 spoken sentences","script":"the full markdown script in the format above"}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 4000);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Assembly returned nothing usable — try again." }, { status: 502 });
    const out = JSON.parse(m[0]);
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
