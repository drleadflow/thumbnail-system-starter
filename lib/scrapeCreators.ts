// ScrapeCreators YouTube search — real view counts, channel ids, publish dates.
export interface LibraryVideo {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  views: number;
  publishedAt: string | null;
  lengthSeconds: number | null;
  thumbnailUrl: string;
}

function bestThumb(t: unknown): string {
  if (typeof t === "string") return t;
  if (Array.isArray(t) && t.length) {
    const sorted = [...t].sort((a, b) => (b?.width || 0) - (a?.width || 0));
    return sorted[0]?.url || "";
  }
  return "";
}

export async function searchYouTube(topic: string, limit = 18): Promise<LibraryVideo[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("SCRAPECREATORS_API_KEY not set — add it to .env.local");
  const r = await fetch(
    `https://api.scrapecreators.com/v1/youtube/search?query=${encodeURIComponent(topic)}&includeExtras=true`,
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30_000) },
  );
  if (!r.ok) throw new Error(`ScrapeCreators HTTP ${r.status}`);
  const data = await r.json();
  const vids: Record<string, unknown>[] = Array.isArray(data?.videos) ? data.videos : [];
  return vids
    .filter((v) => typeof v.id === "string" && v.id)
    .map((v) => ({
      videoId: String(v.id),
      title: String(v.title || "").slice(0, 200),
      channel: String((v.channel as Record<string, unknown> | undefined)?.title || "").slice(0, 120),
      channelId: String((v.channel as Record<string, unknown> | undefined)?.id || ""),
      views: Number(v.viewCountInt) || 0,
      publishedAt: typeof v.publishedTime === "string" ? v.publishedTime : null,
      lengthSeconds: Number(v.lengthSeconds) || null,
      thumbnailUrl: bestThumb(v.thumbnail) || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

// First ~45 seconds of a video's spoken transcript — its hook.
export async function fetchSpokenHook(videoId: string): Promise<string> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("SCRAPECREATORS_API_KEY not set");
  const r = await fetch(
    `https://api.scrapecreators.com/v1/youtube/video/transcript?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(45_000) },
  );
  if (!r.ok) throw new Error(`transcript HTTP ${r.status}`);
  const d = await r.json();
  const segs: { text: string; startMs: string }[] = Array.isArray(d?.transcript) ? d.transcript : [];
  return segs
    .filter((s) => Number(s.startMs) < 45_000)
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}
