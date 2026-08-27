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

// A channel's recent uploads with view counts — powers outlier baselines and
// the watchlist. (YouTube's public RSS feed was retired in Aug 2026; this is
// the replacement. 1 credit per channel, cached by callers.)
export async function channelVideos(channelId: string, limit = 15): Promise<LibraryVideo[]> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("SCRAPECREATORS_API_KEY not set — add it to .env.local");
  const r = await fetch(
    `https://api.scrapecreators.com/v1/youtube/channel-videos?channelId=${encodeURIComponent(channelId)}`,
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30_000) },
  );
  if (!r.ok) throw new Error(`ScrapeCreators channel-videos HTTP ${r.status}`);
  const data = await r.json();
  const vids: Record<string, unknown>[] = Array.isArray(data?.videos) ? data.videos : [];
  return vids
    .filter((v) => typeof v.id === "string" && v.id)
    .map((v) => ({
      videoId: String(v.id),
      title: String(v.title || "").slice(0, 200),
      channel: String((v.channel as Record<string, unknown> | undefined)?.title || "").slice(0, 120),
      channelId,
      views: Number(v.viewCountInt) || 0,
      publishedAt: typeof v.publishDate === "string" ? v.publishDate : (typeof v.publishedTime === "string" ? v.publishedTime : null),
      lengthSeconds: Number(v.lengthSeconds) || null,
      thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    }))
    .slice(0, limit);
}

// A video's spoken transcript: the full FIRST MINUTE (the hook — how they
// actually open) plus the whole transcript for the reader modal.
export async function fetchTranscript(videoId: string): Promise<{ hook: string; full: string }> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("SCRAPECREATORS_API_KEY not set");
  const r = await fetch(
    `https://api.scrapecreators.com/v1/youtube/video/transcript?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { headers: { "x-api-key": key }, signal: AbortSignal.timeout(45_000) },
  );
  if (!r.ok) throw new Error(`transcript HTTP ${r.status}`);
  const d = await r.json();
  const segs: { text: string; startMs: string }[] = Array.isArray(d?.transcript) ? d.transcript : [];
  const clean = (parts: { text: string }[]) => parts.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  return {
    hook: clean(segs.filter((s) => Number(s.startMs) < 60_000)).slice(0, 2500),
    full: clean(segs).slice(0, 60_000),
  };
}
