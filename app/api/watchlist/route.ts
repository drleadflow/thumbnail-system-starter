// GET ?days=&sort=date|views|outlier&channelId= → channels + scored uploads (stale flag)
// POST { channelId, title? } → track + scan; POST { rescan: true } → rescan all
// DELETE ?channelId= → stop tracking
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { scanWatchedChannel } from "@/lib/outliers";

export const maxDuration = 120;
const STALE_MS = 6 * 3600_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") || "", 10);
  const sortParam = url.searchParams.get("sort") || "date";
  const channelId = (url.searchParams.get("channelId") || "").trim();
  try {
    const { data: channels, error: chErr } = await db().from("watch_channels").select("*").order("added_at", { ascending: true });
    if (chErr) throw new Error(chErr.message);
    const sort = sortParam === "views" ? "views" : sortParam === "outlier" ? "outlier_ratio" : "published_at";
    let q = db().from("watch_videos").select("*");
    if (channelId) q = q.eq("channel_id", channelId);
    if (Number.isFinite(days) && days > 0) q = q.gte("published_at", new Date(Date.now() - days * 86400_000).toISOString());
    const { data: videos, error: vErr } = await q.order(sort, { ascending: false, nullsFirst: false }).limit(120);
    if (vErr) throw new Error(vErr.message);
    const stale = (channels || []).some((c) => !c.last_scanned_at || Date.now() - Date.parse(c.last_scanned_at) > STALE_MS);
    return NextResponse.json({
      ok: true, stale,
      channels: (channels || []).map((c) => ({ channelId: c.channel_id, title: c.title, notes: c.notes || "" })),
      videos: (videos || []).map((r) => ({
        videoId: r.video_id, title: r.title, channel: r.channel, channelId: r.channel_id, views: r.views,
        publishedAt: r.published_at, thumbnailUrl: r.thumbnail_url,
        watchUrl: `https://www.youtube.com/watch?v=${r.video_id}`,
        outlierRatio: r.outlier_ratio === null ? null : Number(r.outlier_ratio),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "watchlist read failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    if (body.rescan === true) {
      const { data: channels, error } = await db().from("watch_channels").select("channel_id, title");
      if (error) throw new Error(error.message);
      const results = await Promise.allSettled((channels || []).map((c) => scanWatchedChannel(c.channel_id, c.title)));
      return NextResponse.json({ ok: true, scanned: results.filter((r) => r.status === "fulfilled").length });
    }
    const channelId = String(body.channelId || "").trim();
    if (!/^UC[A-Za-z0-9_-]{10,}$/.test(channelId)) return NextResponse.json({ error: "Pass a valid channel id (starts with UC…)." }, { status: 400 });
    const { error } = await db().from("watch_channels").upsert(
      { channel_id: channelId, title: String(body.title || "").slice(0, 120) }, { onConflict: "channel_id" });
    if (error) throw new Error(error.message);
    const vids = await scanWatchedChannel(channelId, String(body.title || ""));
    return NextResponse.json({ ok: true, videos: vids.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "watchlist update failed" }, { status: 502 });
  }
}

// PATCH { channelId, notes } — the WHY behind tracking this channel. Feeds the
// Idea Engine ("kaleidoscope of context": what you want from them, what to avoid).
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const channelId = String(body.channelId || "").trim();
  if (!channelId) return NextResponse.json({ error: "Pass channelId." }, { status: 400 });
  const { error } = await db().from("watch_channels").update({ notes: String(body.notes ?? "").slice(0, 500) }).eq("channel_id", channelId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const channelId = (new URL(req.url).searchParams.get("channelId") || "").trim();
  if (!channelId) return NextResponse.json({ error: "Pass ?channelId=" }, { status: 400 });
  const { error } = await db().from("watch_channels").delete().eq("channel_id", channelId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
