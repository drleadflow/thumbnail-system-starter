// Closes the analyze → fix loop: rewrites the script's OPENING (the spoken
// first ~45 seconds) by applying the analyzer's specific fixes — in the
// creator's voice, never inventing facts they didn't state.
//   POST { title, topic, hook, content, fixes: [{pattern,current,fix}] }
//   → { opening, hook, changes: ["..."] }
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 180;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const hook = String(body.hook || "").trim();
  const content = String(body.content || "").trim();
  const fixes: { pattern?: string; current?: string; fix?: string }[] = Array.isArray(body.fixes) ? body.fixes.slice(0, 5) : [];
  if (!hook && !content) return NextResponse.json({ error: "Nothing to rewrite yet." }, { status: 400 });
  if (!fixes.length) return NextResponse.json({ error: "Run Analyze first — the rewrite applies its fixes." }, { status: 400 });

  const { data: voiceRows } = await db().from("scripts").select("voice_transcript")
    .neq("voice_transcript", "").order("created_at", { ascending: false }).limit(3);
  const voice = (voiceRows || []).map((v) => String(v.voice_transcript).slice(0, 1000));

  const prompt = [
    (await profileBlock()),
    "You are rewriting the OPENING of a YouTube script — the spoken first ~45 seconds — by applying specific fixes from an analysis. Nothing else changes.",
    "",
    body.title ? `TITLE: ${String(body.title)}` : "",
    body.topic ? `TOPIC: ${String(body.topic)}` : "",
    "CURRENT HOOK:", hook || "(none written)",
    content ? `\nSCRIPT (for context — mine it for specifics the opening should surface):\n${content.slice(0, 6000)}` : "",
    voice.length ? "\nHOW THE CREATOR ACTUALLY TALKS (match this register):\n" + voice.map((v) => `- ${v}`).join("\n") : "",
    "",
    "THE FIXES TO APPLY (from analysis against this topic's winning videos):",
    ...fixes.map((f, i) => `${i + 1}. ${f.pattern}: ${f.fix}`),
    "",
    "RULES:",
    "- Written to be SPOKEN aloud. Plain, direct, first person. No hype words, no 'in this video', no throat-clearing.",
    "- NEVER invent facts. If a fix calls for a specific number the creator hasn't stated anywhere in the script, put a clearly-marked placeholder like [YOUR NUMBER: views on video 1] instead of making one up — and keep placeholders to the absolute minimum.",
    "- Pull real specifics from the script body wherever they exist.",
    "- The opening is 60-120 words: hook first, then the promise/setup that earns the next minute.",
    "",
    'Return ONLY raw JSON: {"hook": "the new first 1-3 sentences", "opening": "the full 60-120 word spoken opening including the hook", "changes": ["3-5 short lines: what changed and which fix it applies"]}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 1500);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Rewrite returned nothing usable — try again." }, { status: 502 });
    const d = JSON.parse(m[0]);
    return NextResponse.json({
      ok: true,
      hook: String(d.hook || "").slice(0, 2000),
      opening: String(d.opening || "").slice(0, 4000),
      changes: (Array.isArray(d.changes) ? d.changes : []).map((c: unknown) => String(c).slice(0, 200)).slice(0, 6),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "rewrite failed" }, { status: 502 });
  }
}
