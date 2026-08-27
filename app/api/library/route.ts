// GET ?topic=&days=&sort=views|outlier → saved research; GET (no topic) → topic index
// POST { topic } → live scan + outlier-score + persist
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { scanTopic } from "@/lib/outliers";

export const maxDuration = 120;

function toItem(r: Record<string, unknown>) {
  return {
    videoId: r.video_id, title: r.title, channel: r.channel, channelId: r.channel_id, views: r.views,
    publishedAt: r.published_at, thumbnailUrl: r.thumbnail_url,
    watchUrl: `https://www.youtube.com/watch?v=${r.video_id}`,
    outlierRatio: r.outlier_ratio === null ? null : Number(r.outlier_ratio),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = (url.searchParams.get("topic") || "").trim();
  const days = parseInt(url.searchParams.get("days") || "", 10);
  const sort = url.searchParams.get("sort") === "outlier" ? "outlier_ratio" : "views";
  try {
    if (!topic) {
      const { data, error } = await db().from("thumb_library").select("topic, scanned_at").order("scanned_at", { ascending: false }).limit(2000);
      if (error) throw new Error(error.message);
      const seen = new Map<string, { topic: string; count: number }>();
      for (const r of data || []) {
        const cur = seen.get(r.topic);
        if (cur) cur.count += 1; else seen.set(r.topic, { topic: r.topic, count: 1 });
      }
      return NextResponse.json({ ok: true, topics: [...seen.values()] });
    }
    let q = db().from("thumb_library").select("*").ilike("topic", topic);
    if (Number.isFinite(days) && days > 0) q = q.gte("published_at", new Date(Date.now() - days * 86400_000).toISOString());
    const { data, error } = await q.order(sort, { ascending: false, nullsFirst: false }).limit(60);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, topic, items: (data || []).map(toItem) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "library read failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").trim().toLowerCase();
  if (!topic) return NextResponse.json({ error: "Pick a topic first." }, { status: 400 });
  try {
    const scored = await scanTopic(topic);
    return NextResponse.json({
      ok: true, topic, scanned: scored.length,
      items: scored.map((v) => ({ ...v, watchUrl: `https://www.youtube.com/watch?v=${v.videoId}` })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "scan failed" }, { status: 502 });
  }
}
