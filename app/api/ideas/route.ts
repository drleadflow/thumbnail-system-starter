// The Idea Engine — research-backed video ideas, Briar Cochran style.
// Evidence in: your watchlist's outliers (with your notes on WHY you track
// each channel), your research library, and Reddit's unfiltered conversation.
// Context in: your creator profile. Out: 10 ideas, each citing its evidence.
//   POST {}                  → generate 10 ideas, persist as status "new"
//   GET                      → the idea backlog (newest first)
//   PATCH { id, status }     → saved | dismissed | scripted
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { getProfile, profileBlock } from "@/lib/profile";
import { topThreads, RedditThread } from "@/lib/reddit";

export const maxDuration = 240;

interface Idea { title: string; angle: string; why_you: string; evidence: { type: string; source: string; detail: string }[] }

export async function GET() {
  const { data, error } = await db().from("ideas").select("*").neq("status", "dismissed").order("created_at", { ascending: false }).limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ideas: data || [] });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  if (!id || !["new", "saved", "dismissed", "scripted"].includes(status)) return NextResponse.json({ error: "Pass id + a valid status." }, { status: 400 });
  const { error } = await db().from("ideas").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST() {
  const d = db();
  // ── Gather the evidence ──
  const [profile, pBlock, watchRes, chanRes, libRes, mineRes] = await Promise.all([
    getProfile(),
    profileBlock(),
    d.from("watch_videos").select("*").gte("published_at", new Date(Date.now() - 30 * 86400_000).toISOString()).order("outlier_ratio", { ascending: false, nullsFirst: false }).limit(20),
    d.from("watch_channels").select("channel_id, title, notes"),
    d.from("thumb_library").select("title, channel, views, outlier_ratio, topic").order("outlier_ratio", { ascending: false, nullsFirst: false }).limit(20),
    d.from("published_videos").select("title, views, my_outlier, published_at").order("my_outlier", { ascending: false, nullsFirst: false }).limit(15),
  ]);

  const subs = (profile?.subreddits || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const redditBatches = await Promise.all(subs.map((s) => topThreads(s, 8)));
  const reddit: RedditThread[] = redditBatches.flat();

  const notesById = new Map((chanRes.data || []).map((c) => [c.channel_id, { title: c.title, notes: c.notes }]));
  const watchBlock = (watchRes.data || []).slice(0, 16).map((v) => {
    const meta = notesById.get(v.channel_id);
    return `- [${v.outlier_ratio ? `${v.outlier_ratio}x their normal` : "unscored"}] "${v.title}" — ${v.channel}${meta?.notes ? ` (why this channel is tracked: ${meta.notes})` : ""}`;
  }).join("\n");
  const libBlock = (libRes.data || []).slice(0, 14).map((v) => `- [${v.outlier_ratio ? `${v.outlier_ratio}x` : "?"}] "${v.title}" — ${v.channel} (topic: ${v.topic})`).join("\n");
  const redditBlock = reddit.slice(0, 24).map((t) => `- r/${t.subreddit} (top this week): ${t.title}`).join("\n");
  const mineBlock = (mineRes.data || []).filter((v) => v.my_outlier !== null)
    .map((v) => `- [${v.my_outlier}x MY OWN normal] "${v.title}" — ${Number(v.views).toLocaleString()} views`).join("\n");

  if (!watchBlock && !libBlock) {
    return NextResponse.json({ error: "No research yet — track a few channels or search a topic in Thumbnails first, so ideas have evidence behind them." }, { status: 424 });
  }

  const prompt = [
    "You are a YouTube content strategist generating RESEARCH-BACKED video ideas — every idea must trace to specific evidence below, never invented from thin air.",
    "",
    pBlock || "(No creator profile yet — generate broadly useful ideas for the niche the evidence implies, and note that filling the Profile will sharpen results.)",
    "",
    mineBlock ? `THE CREATOR'S OWN PUBLISHED RESULTS (each scored vs THEIR channel's own normal — the strongest evidence of all, because it is calibrated to THIS creator and THIS audience):\n${mineBlock}\n` : "",
    watchBlock ? `WHAT'S OVERPERFORMING ON TRACKED CHANNELS (last 30 days, scored vs each channel's own normal):\n${watchBlock}` : "",
    libBlock ? `\nTOP OUTLIERS FROM TOPIC RESEARCH:\n${libBlock}` : "",
    redditBlock ? `\nWHAT PEOPLE ARE ACTUALLY DISCUSSING (Reddit, this week — unfiltered conversation):\n${redditBlock}` : "",
    "",
    "Generate EXACTLY 10 video ideas. Rules:",
    "- Each idea cites its evidence: which outlier(s), which Reddit thread(s), or which cross-signal (e.g. 'hot on two channels AND Reddit') inspired it. Evidence entries reference REAL items from above.",
    "- Steal the PATTERN that made the evidence win (format, angle, promise) — never clone a specific video. The idea must be makeable by THIS creator for THEIR audience.",
    "- Respect the never-talk-about list absolutely.",
    "- Mix: some ride a proven format onto the creator's pillars, some bring an outside-niche pattern in, some answer a live Reddit conversation.",
    mineBlock ? '- CALIBRATE TO THEIR OWN RESULTS: at least 3 ideas should extend what already overperformed on THEIR channel (evidence type "my-results", citing their video + multiplier), and no idea should repeat the shape of their clear underperformers unless it fixes what failed.' : "",
    "- why_you: one line on why THIS creator specifically should make it (credibility, audience fit, pillar match).",
    "- Titles are working titles in the creator's register — direct, specific, no clickbait-y ALL CAPS.",
    "",
    'Return ONLY a raw JSON array of exactly 10: [{"title":"...","angle":"1-2 lines: the take and rough shape","why_you":"...","evidence":[{"type":"outlier|reddit|cross-signal|my-results","source":"channel or subreddit","detail":"the specific item + its number (e.g. 6.7x, 1.2k upvotes)"}]}]',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 4000);
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "Idea generation returned nothing usable — try again." }, { status: 502 });
    const parsed = (JSON.parse(m[0]) as Idea[]).filter((i) => i?.title).slice(0, 10);
    const rows = parsed.map((i) => ({
      title: String(i.title).slice(0, 300),
      angle: String(i.angle || "").slice(0, 1000),
      why_you: String(i.why_you || "").slice(0, 500),
      evidence: (Array.isArray(i.evidence) ? i.evidence : []).slice(0, 4).map((e) => ({
        type: String(e.type || "").slice(0, 20), source: String(e.source || "").slice(0, 120), detail: String(e.detail || "").slice(0, 300),
      })),
      status: "new",
    }));
    const { data, error } = await d.from("ideas").insert(rows).select("*");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, ideas: data, usedReddit: reddit.length > 0, usedProfile: Boolean(pBlock) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "idea generation failed" }, { status: 502 });
  }
}
