// POST { draft, title?, topic?, refs: [{hook,title,channel,outlierRatio?}] }
// → 5 rewrites of YOUR hook on the winners' MECHANICS, in YOUR voice.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const draft = String(body.draft || "").trim();
  if (!draft) return NextResponse.json({ error: "Write a draft hook first — even one rough sentence." }, { status: 400 });
  const refs: { hook: string; title: string; channel: string; outlierRatio?: number | null }[] = Array.isArray(body.refs) ? body.refs.slice(0, 8) : [];

  // Voice corpus: the user's REAL spoken transcripts (from voice notes).
  const { data: voiceRows } = await db().from("scripts").select("voice_transcript")
    .neq("voice_transcript", "").order("created_at", { ascending: false }).limit(3);
  const voice = (voiceRows || []).map((v) => String(v.voice_transcript).slice(0, 1000));

  const refBlock = refs.filter((r) => r.hook?.trim())
    .map((r, i) => `${i + 1}. [${r.channel}${r.outlierRatio ? ` — ${r.outlierRatio}x this channel's normal` : ""}] "${r.title}"\n   SPOKEN HOOK: ${r.hook.slice(0, 600)}`)
    .join("\n");

  const prompt = [
    (await profileBlock()),
    "You are a YouTube hook doctor. Below are the ACTUAL SPOKEN OPENINGS of top-performing videos on this topic — high multipliers massively outperformed their own channel's normal.",
    `TOPIC: ${String(body.topic || "")}`,
    body.title ? `MY VIDEO'S WORKING TITLE: ${String(body.title)}` : "",
    "", "MY DRAFT HOOK:", draft,
    voice.length ? "\nHOW I ACTUALLY TALK (real transcripts — match THIS register):\n" + voice.map((v) => `- ${v}`).join("\n") : "",
    "", "WHAT'S WINNING:", refBlock || "(no reference hooks — optimize from first principles)",
    "",
    "TASK: Rewrite my hook 5 ways. Rules:",
    "- Steal MECHANICS from the winners (curiosity gap, receipts, contrarian open, negative frame, in-media-res, direct callout) — NEVER their words or claims.",
    "- Keep MY voice: plain, direct, first-person. No hype, no 'in this video', no throat-clearing.",
    "- Every claim must come from MY draft — invent nothing.",
    "- First 3 words must earn attention. Each variant a DIFFERENT mechanism. 1-3 sentences, written to be SPOKEN.",
    "",
    'Return ONLY a raw JSON array: [{"hook":"...","mechanism":"2-4 words","why":"one line citing which winner proves the pattern"}]',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 1600);
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "Optimizer returned nothing usable — try again." }, { status: 502 });
    const variants = (JSON.parse(m[0]) as { hook?: string; mechanism?: string; why?: string }[])
      .filter((v) => v.hook?.trim()).slice(0, 6)
      .map((v) => ({ hook: String(v.hook).slice(0, 1200), mechanism: String(v.mechanism || "").slice(0, 60), why: String(v.why || "").slice(0, 300) }));
    return NextResponse.json({ ok: true, variants });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "optimize failed" }, { status: 502 });
  }
}
