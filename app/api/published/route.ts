// The calibration loop, part 1 — YOUR published videos, scored against YOUR
// channel's own normal. This is where the tool starts learning what works
// for you specifically, not just for competitors.
//   POST { url, scriptId? }  → add a published video (auto-detects your channel)
//   GET                      → list, auto-refreshing stats older than 12h
//   DELETE ?id=
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { channelVideos } from "@/lib/scrapeCreators";

export const maxDuration = 120;
const STALE_MS = 12 * 3600_000;

function parseVideoId(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{6,20})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : "";
}

function median(nums: number[]): number {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function videoDetails(videoId: string) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("SCRAPECREATORS_API_KEY not set");
  const r = await fetch(
    `https://api.scrapecreators.com/v1/youtube/video?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30_000) },
  );
  if (!r.ok) throw new Error(`video lookup HTTP ${r.status}`);
  const d = await r.json();
  return {
    title: String(d.title || "").slice(0, 300),
    views: Number(d.viewCountInt) || 0,
    likes: Number(d.likeCountInt) || 0,
    comments: Number(d.commentCountInt) || 0,
    publishedAt: typeof d.publishDate === "string" ? d.publishDate : null,
    channelId: String((d.channel || {}).id || ""),
  };
}

async function myBaseline(channelId: string): Promise<number> {
  if (!channelId) return 0;
  try { return median((await channelVideos(channelId, 15)).map((v) => v.views)); } catch { return 0; }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const videoId = parseVideoId(String(body.url || body.videoId || ""));
  if (!videoId) return NextResponse.json({ error: "Paste a YouTube URL (or video id)." }, { status: 400 });
  try {
    const det = await videoDetails(videoId);
    // Learn your channel from the video itself — no setup needed.
    if (det.channelId) {
      await db().from("creator_profile").update({ my_channel: det.channelId }).eq("id", 1);
    }
    const base = await myBaseline(det.channelId);
    const my_outlier = base > 0 && det.views > 0 ? Math.round((det.views / base) * 100) / 100 : null;
    const { error } = await db().from("published_videos").upsert({
      video_id: videoId, script_id: body.scriptId ? String(body.scriptId) : null,
      title: det.title, published_at: det.publishedAt, views: det.views, likes: det.likes,
      comments: det.comments, my_outlier, thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      last_checked: new Date().toISOString(),
    }, { onConflict: "video_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, videoId, views: det.views, myOutlier: my_outlier });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "add failed" }, { status: 502 });
  }
}

export async function GET() {
  try {
    const { data, error } = await db().from("published_videos").select("*").order("published_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    const rows = data || [];
    // Refresh stale stats in place (bounded).
    const stale = rows.filter((r: { last_checked: string | null }) => !r.last_checked || Date.now() - Date.parse(r.last_checked) > STALE_MS).slice(0, 6);
    if (stale.length) {
      const { data: prof } = await db().from("creator_profile").select("my_channel").eq("id", 1).single();
      const base = await myBaseline(String(prof?.my_channel || ""));
      await Promise.allSettled(stale.map(async (r: { video_id: string }) => {
        const det = await videoDetails(r.video_id);
        const my_outlier = base > 0 && det.views > 0 ? Math.round((det.views / base) * 100) / 100 : null;
        await db().from("published_videos").update({
          views: det.views, likes: det.likes, comments: det.comments, my_outlier,
          last_checked: new Date().toISOString(),
        }).eq("video_id", r.video_id);
      }));
      const { data: fresh } = await db().from("published_videos").select("*").order("published_at", { ascending: false }).limit(100);
      return NextResponse.json({ ok: true, videos: fresh || [], refreshed: stale.length });
    }
    return NextResponse.json({ ok: true, videos: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  const { error } = await db().from("published_videos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
