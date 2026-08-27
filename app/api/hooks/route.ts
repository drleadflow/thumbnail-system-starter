// POST { videos: [{videoId, title?, channel?}] } → the real spoken hooks
// (first ~45s of transcript), cached forever — 1 API credit per video, once.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { fetchSpokenHook } from "@/lib/scrapeCreators";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const videos: { videoId: string; title?: string; channel?: string }[] = Array.isArray(body.videos) ? body.videos.slice(0, 8) : [];
  if (!videos.length) return NextResponse.json({ error: "Pass videos." }, { status: 400 });
  const ids = videos.map((v) => String(v.videoId)).filter((id) => /^[A-Za-z0-9_-]{6,20}$/.test(id));
  try {
    const { data: cached } = await db().from("video_hooks").select("video_id, hook_text").in("video_id", ids);
    const hooks: Record<string, string> = {};
    for (const c of cached || []) hooks[c.video_id] = c.hook_text;
    const missing = videos.filter((v) => hooks[v.videoId] === undefined);
    const fetched = await Promise.allSettled(missing.map(async (v) => ({ v, hook: await fetchSpokenHook(v.videoId) })));
    const rows = [];
    for (const f of fetched) {
      if (f.status === "fulfilled") {
        hooks[f.value.v.videoId] = f.value.hook;
        rows.push({ video_id: f.value.v.videoId, title: String(f.value.v.title || "").slice(0, 200), channel: String(f.value.v.channel || "").slice(0, 120), hook_text: f.value.hook });
      }
    }
    if (rows.length) await db().from("video_hooks").upsert(rows, { onConflict: "video_id" });
    return NextResponse.json({ ok: true, hooks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "hook fetch failed" }, { status: 502 });
  }
}
