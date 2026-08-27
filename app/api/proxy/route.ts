// Proxy a YouTube thumbnail (no CORS on i.ytimg.com) — locked to video ids.
export async function GET(req: Request) {
  const v = new URL(req.url).searchParams.get("v") || "";
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(v)) return new Response("bad video id", { status: 400 });
  let r = await fetch(`https://i.ytimg.com/vi/${v}/maxresdefault.jpg`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) r = await fetch(`https://i.ytimg.com/vi/${v}/hqdefault.jpg`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(await r.arrayBuffer()), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
}
