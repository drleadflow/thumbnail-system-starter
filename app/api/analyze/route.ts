// Script analyzer — compares YOUR script against the actual transcripts of the
// topic's outlier winners and tells you, concretely, what they do that you
// don't. Grounded in real data, not generic script advice.
//   POST { title, topic, hook, content } → { scores, verdict, winners_do, fixes }
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";

export const maxDuration = 180;

interface Winner { title: string; channel: string; outlierRatio: number | null; opening: string }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const topic = String(body.topic || "").trim().toLowerCase();
  const hook = String(body.hook || "").trim();
  const content = String(body.content || "").trim();
  if (!hook && !content) return NextResponse.json({ error: "Write at least a hook or some script before analyzing." }, { status: 400 });

  // The evidence: top outlier videos on this topic + their real spoken openings.
  let winners: Winner[] = [];
  if (topic) {
    const { data: vids } = await db().from("thumb_library").select("video_id, title, channel, outlier_ratio")
      .ilike("topic", topic).order("outlier_ratio", { ascending: false, nullsFirst: false }).limit(8);
    const ids = (vids || []).map((v) => v.video_id);
    const { data: hooksRows } = ids.length
      ? await db().from("video_hooks").select("video_id, hook_text").in("video_id", ids)
      : { data: [] };
    const byId = new Map((hooksRows || []).map((h) => [h.video_id, h.hook_text]));
    winners = (vids || [])
      .map((v) => ({ title: v.title, channel: v.channel, outlierRatio: v.outlier_ratio === null ? null : Number(v.outlier_ratio), opening: String(byId.get(v.video_id) || "") }))
      .filter((w) => w.opening)
      .slice(0, 5);
  }

  const winnerBlock = winners.length
    ? winners.map((w, i) => `WINNER ${i + 1}: "${w.title}" — ${w.channel}${w.outlierRatio ? ` (${w.outlierRatio}x this channel's normal — this opening demonstrably worked)` : ""}\nTHEIR SPOKEN FIRST MINUTE: ${w.opening.slice(0, 1600)}`).join("\n\n")
    : "(No winner transcripts available for this topic yet — analyze from first principles, and say so.)";

  const prompt = [
    "You are a YouTube script doctor. Analyze the creator's script below against the REAL spoken openings of videos that massively outperformed on the same topic. Be specific and honest — this analysis is only useful if it says the uncomfortable things.",
    "",
    "THE CREATOR'S SCRIPT:",
    title ? `TITLE: ${title}` : "",
    hook ? `HOOK (their planned first 30s): ${hook}` : "(no hook written yet)",
    content ? `SCRIPT:\n${content.slice(0, 10_000)}` : "(no body written yet)",
    "",
    "THE EVIDENCE — what actually won on this topic:",
    winnerBlock,
    "",
    "ANALYZE:",
    "1. Score the script 1-10 on each: hook_strength (would the first 15 seconds stop a scroll), specificity (real numbers/names/artifacts vs vague claims), open_loops (promises that keep people watching), payoff_clarity (does it deliver what the title/hook promised), voice (does it sound like a person talking or an essay).",
    "2. patterns_in_winners: 3-5 concrete patterns you observe ACROSS the winning openings above — cite which winner does what. Real observations from the transcripts, not generic advice.",
    "3. whats_missing: the 3 biggest gaps between this script and those patterns — each one names the pattern, quotes or paraphrases what the script currently does, and says exactly what to change.",
    "4. verdict: 2-3 sentences, straight up — is this ready, and what single change matters most.",
    "",
    "Rules: cite winners by number when you reference them. Never invent facts about the script. If the script is genuinely strong somewhere, say so — false criticism is as useless as false praise.",
    "",
    'Return ONLY raw JSON: {"scores":{"hook_strength":n,"specificity":n,"open_loops":n,"payoff_clarity":n,"voice":n},"patterns_in_winners":["..."],"whats_missing":[{"pattern":"...","current":"...","fix":"..."}],"verdict":"..."}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 2500);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Analyzer returned nothing usable — try again." }, { status: 502 });
    const d = JSON.parse(m[0]);
    return NextResponse.json({ ok: true, analysis: d, winnersUsed: winners.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "analysis failed" }, { status: 502 });
  }
}
