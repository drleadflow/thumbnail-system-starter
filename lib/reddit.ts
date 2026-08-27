// Reddit source — Briar's pick because "that's where actual conversation
// happens... unfiltered thoughts." Reddit's JSON API now blocks server
// requests (403), but the Atom feed is still open — titles are the signal.
export interface RedditThread {
  title: string; subreddit: string; ups: number; num_comments: number; permalink: string;
}

export async function topThreads(subreddit: string, limit = 10): Promise<RedditThread[]> {
  const sub = subreddit.replace(/^r\//, "").replace(/[^A-Za-z0-9_]/g, "");
  if (!sub) return [];
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}/top/.rss?t=week`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", Accept: "application/atom+xml,text/xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const out: RedditThread[] = [];
    for (const entry of xml.split("<entry>").slice(1, limit + 1)) {
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
      const link = entry.match(/<link href="([^"]+)"/)?.[1] || "";
      if (!title) continue;
      out.push({ title: decode(title).slice(0, 300), subreddit: sub, ups: 0, num_comments: 0, permalink: link });
    }
    return out;
  } catch { return []; }
}
