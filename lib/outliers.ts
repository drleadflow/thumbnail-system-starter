// Outlier scoring — the 1of10 signal: a video's views ÷ its own channel's
// median views. Baselines come from YouTube's FREE RSS feed (last ~15 uploads
// with view counts, no API key). Also powers the watchlist.
import { searchYouTube, channelVideos, LibraryVideo } from "@/lib/scrapeCreators";
import { db } from "@/lib/supabase";

export interface ScoredVideo extends LibraryVideo { outlierRatio: number | null }
export interface WatchVideo {
  videoId: string; title: string; channel: string; channelId: string;
  views: number; publishedAt: string | null; thumbnailUrl: string; outlierRatio: number | null;
}

function median(nums: number[]): number {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const baselineCache = new Map<string, { value: number; at: number }>();
const TTL = 6 * 3600_000;

async function channelBaseline(channelId: string): Promise<number> {
  const hit = baselineCache.get(channelId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value = 0;
  try {
    value = median((await channelVideos(channelId, 15)).map((v) => v.views));
  } catch { /* ratio stays null */ }
  baselineCache.set(channelId, { value, at: Date.now() });
  return value;
}

export async function scanTopic(topic: string): Promise<ScoredVideo[]> {
  const t = topic.trim().toLowerCase();
  const vids = await searchYouTube(t, 18);
  const ids = [...new Set(vids.map((v) => v.channelId).filter(Boolean))];
  const baselines = new Map<string, number>();
  await Promise.all(ids.map(async (id) => baselines.set(id, await channelBaseline(id))));
  const scored: ScoredVideo[] = vids.map((v) => {
    const base = v.channelId ? baselines.get(v.channelId) || 0 : 0;
    return { ...v, outlierRatio: base > 0 && v.views > 0 ? Math.round((v.views / base) * 10) / 10 : null };
  });
  if (scored.length) {
    const now = new Date().toISOString();
    const { error } = await db().from("thumb_library").upsert(
      scored.map((v) => ({
        topic: t, video_id: v.videoId, title: v.title, channel: v.channel, channel_id: v.channelId,
        views: v.views, published_at: v.publishedAt, length_seconds: v.lengthSeconds,
        thumbnail_url: v.thumbnailUrl, outlier_ratio: v.outlierRatio, scanned_at: now,
      })),
      { onConflict: "topic,video_id" },
    );
    if (error) console.error("[library] upsert failed:", error.message);
  }
  return scored;
}

export async function scanWatchedChannel(channelId: string, channelTitle: string): Promise<WatchVideo[]> {
  const uploads = await channelVideos(channelId, 15);
  if (!uploads.length) throw new Error(`No uploads found for ${channelTitle || channelId}`);
  const feedTitle = uploads[0].channel || channelTitle;
  const vids: WatchVideo[] = uploads.map((u) => ({
    videoId: u.videoId, title: u.title, channel: feedTitle, channelId,
    views: u.views, publishedAt: u.publishedAt, thumbnailUrl: u.thumbnailUrl, outlierRatio: null,
  }));
  const base = median(vids.map((v) => v.views));
  for (const v of vids) v.outlierRatio = base > 0 && v.views > 0 ? Math.round((v.views / base) * 10) / 10 : null;
  if (vids.length) {
    const now = new Date().toISOString();
    const { error } = await db().from("watch_videos").upsert(
      vids.map((v) => ({
        channel_id: v.channelId, video_id: v.videoId, title: v.title, channel: v.channel,
        views: v.views, published_at: v.publishedAt, thumbnail_url: v.thumbnailUrl,
        outlier_ratio: v.outlierRatio, scanned_at: now,
      })),
      { onConflict: "video_id" },
    );
    if (error) console.error("[watchlist] upsert failed:", error.message);
    await db().from("watch_channels").update({ last_scanned_at: now, title: feedTitle }).eq("channel_id", channelId);
  }
  return vids;
}
