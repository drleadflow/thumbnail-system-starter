// The calibration loop, part 2 — what YOUR winners share. Compares your
// published videos (scored vs your own normal) against each other and against
// your linked scripts, then tells you what to double down on and what to drop.
// This is the part that makes the tool smarter about YOU every week.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 180;

export async function POST() {
  const { data: vids } = await db().from("published_videos").select("*").order("my_outlier", { ascending: false, nullsFirst: false }).limit(30);
  const rows = vids || [];
  if (rows.length < 3) {
    return NextResponse.json({ error: "Add at least 3 published videos first — calibration needs your real results to find patterns." }, { status: 424 });
  }
  const scriptIds = rows.map((r: { script_id: string | null }) => r.script_id).filter(Boolean) as string[];
  const { data: scripts } = scriptIds.length
    ? await db().from("scripts").select("id, title, hook").in("id", scriptIds)
    : { data: [] };
  const hooksById = new Map((scripts || []).map((s: { id: string; hook: string }) => [s.id, s.hook]));

  const block = rows.map((r: { title: string; views: number; my_outlier: number | null; published_at: string | null; script_id: string | null; likes: number; comments: number }) => {
    const hook = r.script_id ? hooksById.get(r.script_id) : "";
    return `- [${r.my_outlier ? `${r.my_outlier}x MY normal` : "unscored"}] "${r.title}" — ${r.views.toLocaleString()} views, ${r.likes} likes, ${r.comments} comments${r.published_at ? `, ${String(r.published_at).slice(0, 10)}` : ""}${hook ? `\n  its hook: ${String(hook).slice(0, 200)}` : ""}`;
  }).join("\n");

  const prompt = [
    (await profileBlock()),
    "These are the creator's OWN published videos, each scored against their channel's own median (Nx MY normal — above 1 overperformed, below 1 underperformed):",
    "",
    block,
    "",
    "CALIBRATE — find what actually separates their winners from their losers. Rules:",
    "- Only patterns supported by at least 2 videos. Cite the videos by title fragment + their multiplier.",
    "- Look at: topic/pillar, title construction, promise type, format implied by the title, timing if visible.",
    "- Be honest about weak evidence: with few videos, say 'early signal' not 'proven'.",
    "- double_down: 2-3 concrete things to do MORE of, each tied to evidence.",
    "- drop: 1-2 things the data says to stop doing.",
    "- next_test: ONE specific video to make next that would sharpen the biggest open question in the data.",
    "",
    'Return ONLY raw JSON: {"winners_share":["2-4 patterns, each citing videos+multipliers"],"double_down":["..."],"drop":["..."],"next_test":"one specific video idea + what it would prove","confidence":"one line on how much data this is based on"}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 2000);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Calibration returned nothing usable — try again." }, { status: 502 });
    return NextResponse.json({ ok: true, calibration: JSON.parse(m[0]), videosUsed: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "calibration failed" }, { status: 502 });
  }
}
