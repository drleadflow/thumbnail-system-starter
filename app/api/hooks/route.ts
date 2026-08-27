// Competitor spoken openings + full transcripts, cached forever (1 credit/video).
//   POST { videos: [{videoId, title?, channel?}] } → { hooks: {videoId: firstMinute} }
//   GET  ?videoId=                                 → { hook, fullTranscript, title, channel }
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { fetchTranscript } from "@/lib/scrapeCreators";

export const maxDuration = 120;

export async function GET(req: Request) {
  const videoId = (new URL(req.url).searchParams.get("videoId") || "").trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return NextResponse.json({ error: "bad video id" }, { status: 400 });
  const { data } = await db().from("video_hooks").select("*").eq("video_id", videoId).single();
  if (data?.hook_text || data?.full_transcript) {
    return NextResponse.json({ ok: true, hook: data.hook_text, fullTranscript: data.full_transcript, title: data.title, channel: data.channel });
  }
  try {
    const t = await fetchTranscript(videoId);
    await db().from("video_hooks").upsert({ video_id: videoId, hook_text: t.hook, full_transcript: t.full }, { onConflict: "video_id" });
    return NextResponse.json({ ok: true, hook: t.hook, fullTranscript: t.full, title: "", channel: "" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "transcript fetch failed" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const videos: { videoId: string; title?: string; channel?: string }[] = Array.isArray(body.videos) ? body.videos.slice(0, 8) : [];
  if (!videos.length) return NextResponse.json({ error: "Pass videos." }, { status: 400 });
  const ids = videos.map((v) => String(v.videoId)).filter((id) => /^[A-Za-z0-9_-]{6,20}$/.test(id));
  try {
    // Cache hit requires the full transcript too (older rows may predate it).
    const { data: cached } = await db().from("video_hooks").select("video_id, hook_text, full_transcript").in("video_id", ids);
    const hooks: Record<string, string> = {};
    const complete = new Set<string>();
    for (const c of cached || []) {
      hooks[c.video_id] = c.hook_text;
      if (c.full_transcript) complete.add(c.video_id);
    }
    const missing = videos.filter((v) => !complete.has(v.videoId));
    const fetched = await Promise.allSettled(missing.map(async (v) => ({ v, t: await fetchTranscript(v.videoId) })));
    const rows = [];
    for (const f of fetched) {
      if (f.status === "fulfilled") {
        hooks[f.value.v.videoId] = f.value.t.hook;
        rows.push({
          video_id: f.value.v.videoId, title: String(f.value.v.title || "").slice(0, 200),
          channel: String(f.value.v.channel || "").slice(0, 120),
          hook_text: f.value.t.hook, full_transcript: f.value.t.full,
        });
      }
    }
    if (rows.length) await db().from("video_hooks").upsert(rows, { onConflict: "video_id" });
    return NextResponse.json({ ok: true, hooks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "hook fetch failed" }, { status: 502 });
  }
}
