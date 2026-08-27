"use client";

// Thumbnail Studio — research library, channel watchlist, avatars, generation,
// iteration, history. One page, the whole loop.
import { useEffect, useRef, useState } from "react";

interface LibItem { videoId: string; title: string; channel: string; channelId?: string; views: number; thumbnailUrl: string; watchUrl: string; publishedAt?: string | null; outlierRatio?: number | null }
interface Avatar { id: string; name: string; person: string; image: string; is_default: boolean; use_for_likeness: boolean }
interface Session { id: string; instructions: string; ref_images: string[]; outputs: string[]; took_ms: number | null; created_at: string }

const fmtV = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);
const ago = (iso?: string | null) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400_000);
  return d <= 0 ? "today" : d < 30 ? `${d}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
};

function OutlierBadge({ r }: { r?: number | null }) {
  if (typeof r !== "number" || r < 2) return null;
  return <span className={`absolute top-1 right-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded ${r >= 10 ? "bg-green-600 text-white" : "bg-black/70 text-green-400"}`}>{r >= 100 ? Math.round(r) : r}x</span>;
}

export default function ThumbnailStudio() {
  // library
  const [topics, setTopics] = useState<{ topic: string; count: number }[]>([]);
  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<LibItem[]>([]);
  const [days, setDays] = useState(0);
  const [sort, setSort] = useState<"views" | "outlier">("views");
  const [libBusy, setLibBusy] = useState(false);
  const [libErr, setLibErr] = useState<string | null>(null);
  // watchlist
  const [wChannels, setWChannels] = useState<{ channelId: string; title: string; notes?: string }[]>([]);
  const [wVideos, setWVideos] = useState<LibItem[]>([]);
  const [wSort, setWSort] = useState<"date" | "views" | "outlier">("date");
  const [wErr, setWErr] = useState<string | null>(null);
  // avatars
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const avatarFile = useRef<HTMLInputElement>(null);
  // generation
  const [refs, setRefs] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [count, setCount] = useState(3);
  const [vary, setVary] = useState(true);
  const [useFace, setUseFace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTopics = () => fetch("/api/library").then((r) => r.json()).then((j) => setTopics(j.topics || [])).catch(() => {});
  const loadAvatars = () => fetch("/api/avatars").then((r) => r.json()).then((j) => setAvatars(j.avatars || [])).catch(() => {});
  const loadHistory = () => fetch("/api/history").then((r) => r.json()).then((j) => setSessions(j.sessions || [])).catch(() => {});
  const loadWatchlist = (s = wSort) =>
    fetch(`/api/watchlist?sort=${s}`).then((r) => r.json()).then((j) => {
      if (j.error) return setWErr(j.error);
      setWChannels(j.channels || []); setWVideos(j.videos || []);
      if (j.stale && (j.channels || []).length) {
        fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rescan: true }) })
          .then(() => loadWatchlist(s)).catch(() => {});
      }
    }).catch((e) => setWErr(String(e)));

  useEffect(() => { loadTopics(); loadAvatars(); loadHistory(); loadWatchlist(); }, []); // eslint-disable-line

  async function search(t = topic, forceScan = false, d = days, s = sort) {
    const q = t.trim().toLowerCase();
    if (!q || libBusy) return;
    setLibBusy(true); setLibErr(null); setTopic(q);
    try {
      if (!forceScan) {
        const j = await fetch(`/api/library?topic=${encodeURIComponent(q)}${d ? `&days=${d}` : ""}&sort=${s}`).then((r) => r.json());
        if ((j.items || []).length || d) { setItems(j.items || []); return; }
      }
      const j = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: q }) }).then((r) => r.json());
      if (j.error) setLibErr(j.error); else { setItems(j.items || []); loadTopics(); }
    } catch (e) { setLibErr(String(e)); } finally { setLibBusy(false); }
  }

  async function useAsRef(item: LibItem) {
    if (refs.length >= 6) { setLibErr("Reference slots full (6) — remove one first."); return; }
    try {
      const blob = await fetch(`/api/proxy?v=${item.videoId}`).then((r) => r.blob());
      const dataUrl: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(blob); });
      setRefs((p) => [...p, dataUrl]);
      setInstructions((p) => p.trim() ? p : "Redesign this concept in MY channel style — keep what makes it clickable (the hook, the composition idea), but change the colours, typography and subject treatment to match my brand. Original, never a copy.");
      document.getElementById("gen-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch { setLibErr("Couldn't load that thumbnail."); }
  }

  async function track(item: LibItem) {
    if (!item.channelId) return;
    const j = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId: item.channelId, title: item.channel }) }).then((r) => r.json());
    if (j.error) setWErr(j.error); else loadWatchlist();
  }

  async function uploadAvatars(files: FileList | null) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    for (const f of list) {
      const name = list.length === 1 ? window.prompt("Name this avatar:", f.name.replace(/\.[^.]+$/, "")) : f.name.replace(/\.[^.]+$/, "");
      if (!name) continue;
      const dataUrl: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(f); });
      await fetch("/api/avatars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, image: dataUrl }) });
    }
    loadAvatars();
  }

  async function patchAvatar(id: string, patch: Record<string, unknown>, optimistic: (a: Avatar) => Avatar) {
    setAvatars((p) => p.map((a) => (a.id === id ? optimistic(a) : patch.makeDefault ? { ...a, is_default: false } : a)));
    await fetch("/api/avatars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
  }

  async function generate() {
    if (busy) return;
    if (!refs.length && !instructions.trim()) { setGenErr("Add a reference image or some instructions."); return; }
    setBusy(true); setGenErr(null); setResults([]);
    try {
      const j = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: refs, instructions, count, vary, useFace, avatarId: avatarId || undefined }),
      }).then((r) => r.json());
      if (j.error) setGenErr(j.error); else { setResults(j.images || []); loadHistory(); }
    } catch (e) { setGenErr(String(e)); } finally { setBusy(false); }
  }

  const tweak = (src: string) => {
    setRefs([src]);
    document.getElementById("gen-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const Card = ({ it, trackBtn }: { it: LibItem; trackBtn?: boolean }) => (
    <div className="rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900">
      <div className="relative">
        <img src={it.thumbnailUrl} alt={it.title} loading="lazy" className="w-full aspect-video object-cover" />
        <OutlierBadge r={it.outlierRatio} />
      </div>
      <div className="p-2 space-y-0.5">
        <div className="text-[11.5px] font-semibold leading-tight line-clamp-2">{it.title}</div>
        <div className="text-[10.5px] text-neutral-400 truncate">{it.channel} · <b className="text-amber-400">{fmtV(it.views)}</b>{it.publishedAt ? ` · ${ago(it.publishedAt)}` : ""}</div>
        <div className="flex items-center gap-2 pt-0.5 text-[11px]">
          <button onClick={() => useAsRef(it)} className="font-semibold text-amber-400">Use as ref</button>
          <a href={it.watchUrl} target="_blank" rel="noreferrer" className="text-neutral-400">Watch ↗</a>
          {trackBtn && it.channelId && !wChannels.some((c) => c.channelId === it.channelId) && (
            <button onClick={() => track(it)} className="text-neutral-400">+ Track</button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Research Library ── */}
      <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[15px] font-bold">Research Library</h2>
            <p className="text-[12px] text-neutral-400">Search once, saved forever. Outlier score = views ÷ that channel&rsquo;s own normal.</p>
          </div>
          <div className="flex gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Search or scan a topic…" className="w-60 px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
            <button onClick={() => search()} disabled={libBusy} className="px-3 py-2 rounded-md text-[13px] font-semibold bg-amber-500 text-black disabled:opacity-50">{libBusy ? "…" : "Search"}</button>
            {items.length > 0 && <button onClick={() => search(topic, true)} disabled={libBusy} className="px-3 py-2 rounded-md text-[13px] border border-amber-500/40 text-amber-400">Rescan</button>}
          </div>
        </div>
        {topics.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {topics.slice(0, 12).map((t) => (
              <button key={t.topic} onClick={() => search(t.topic)} className={`px-2.5 py-1 rounded-full text-[11px] border ${topic === t.topic ? "border-amber-500/60 text-amber-400 bg-amber-500/10" : "border-neutral-800 text-neutral-400"}`}>{t.topic} · {t.count}</button>
            ))}
          </div>
        )}
        {topic && (
          <div className="flex gap-3 flex-wrap text-[11px]">
            <div className="inline-flex rounded-md overflow-hidden border border-neutral-800">
              {[["All time", 0], ["7d", 7], ["30d", 30], ["90d", 90]].map(([l, d]) => (
                <button key={String(d)} onClick={() => { setDays(d as number); search(topic, false, d as number, sort); }}
                  className={`px-2.5 py-1 font-semibold ${days === d ? "bg-amber-500 text-black" : "text-neutral-400"}`}>{l}</button>
              ))}
            </div>
            <div className="inline-flex rounded-md overflow-hidden border border-neutral-800">
              {[["Top views", "views"], ["Top outliers", "outlier"]].map(([l, s]) => (
                <button key={String(s)} onClick={() => { setSort(s as "views" | "outlier"); search(topic, false, days, s as "views" | "outlier"); }}
                  className={`px-2.5 py-1 font-semibold ${sort === s ? "bg-amber-500 text-black" : "text-neutral-400"}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {libErr && <div className="text-[12px] text-red-400">{libErr}</div>}
        {items.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{items.map((it) => <Card key={it.videoId} it={it} trackBtn />)}</div>}
      </section>

      {/* ── Watchlist ── */}
      {wChannels.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[15px] font-bold">Channel Watchlist</h2>
              <p className="text-[12px] text-neutral-400">Tracked competitors — every upload scored vs their own normal, auto-refreshed.</p>
            </div>
            <div className="inline-flex rounded-md overflow-hidden border border-neutral-800 text-[11px]">
              {[["Latest", "date"], ["Top views", "views"], ["Top outliers", "outlier"]].map(([l, s]) => (
                <button key={String(s)} onClick={() => { setWSort(s as typeof wSort); loadWatchlist(s as typeof wSort); }}
                  className={`px-2.5 py-1 font-semibold ${wSort === s ? "bg-amber-500 text-black" : "text-neutral-400"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {wChannels.map((c) => (
              <span key={c.channelId} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border border-neutral-800 text-neutral-300" title={c.notes || "No note yet — say WHY you track this channel; the Idea Engine uses it"}>
                {c.title}
                <button onClick={async () => {
                  const notes = window.prompt(`Why do you track ${c.title}? What do you want from them — and what should be ignored?\n(The Idea Engine reads this.)`, c.notes || "");
                  if (notes === null) return;
                  await fetch("/api/watchlist", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId: c.channelId, notes }) });
                  loadWatchlist();
                }} className={c.notes ? "text-amber-400" : "opacity-60"}>✎</button>
                <button onClick={async () => { await fetch(`/api/watchlist?channelId=${c.channelId}`, { method: "DELETE" }); loadWatchlist(); }} className="opacity-60">×</button>
              </span>
            ))}
          </div>
          {wErr && <div className="text-[12px] text-red-400">{wErr}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{wVideos.slice(0, 16).map((it) => <Card key={it.videoId} it={it} />)}</div>
        </section>
      )}

      {/* ── Generate ── */}
      <section id="gen-panel" className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
        <h2 className="text-[15px] font-bold">Generate</h2>
        <div className="flex gap-2 flex-wrap">
          {refs.map((r, i) => (
            <div key={i} className="relative">
              <img src={r} alt="ref" className="h-20 aspect-video object-cover rounded border border-neutral-700" />
              <button onClick={() => setRefs((p) => p.filter((_, x) => x !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-800 text-[11px]">×</button>
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()} className="h-20 aspect-video rounded border border-dashed border-neutral-700 text-[11px] text-neutral-400">+ image</button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
            Array.from(e.target.files || []).forEach((f) => { const fr = new FileReader(); fr.onload = () => setRefs((p) => p.length >= 6 ? p : [...p, fr.result as string]); fr.readAsDataURL(f); });
            e.target.value = "";
          }} />
        </div>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3}
          placeholder="What to make / change — be precise, including any text the thumbnail should say…"
          className="w-full px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
        <div className="flex items-center gap-4 flex-wrap text-[12.5px]">
          <label className="flex items-center gap-1.5">Versions
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={vary} onChange={(e) => setVary(e.target.checked)} /> Vary each version</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={useFace} onChange={(e) => setUseFace(e.target.checked)} /> <b className={useFace ? "text-amber-400" : ""}>Use my face</b></label>
        </div>

        {useFace && (
          <div className="rounded-lg border border-amber-500/30 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-widest text-amber-400">Avatars · 👁 = extra likeness angle · only same-person photos ever mix</span>
              <button onClick={() => avatarFile.current?.click()} className="text-[11px] font-semibold text-amber-400">+ Add photos</button>
              <input ref={avatarFile} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { uploadAvatars(e.target.files); e.target.value = ""; }} />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {avatars.map((a) => {
                const active = avatarId ? avatarId === a.id : a.is_default;
                return (
                  <div key={a.id} className="shrink-0 w-[76px]">
                    <img src={a.image} alt={a.name} onClick={() => setAvatarId(a.id === avatarId ? "" : a.id)}
                      className={`w-[76px] h-[76px] object-cover object-top rounded-lg cursor-pointer border-2 ${active ? "border-amber-500" : "border-neutral-800 opacity-70"}`} />
                    <div className="text-[9.5px] mt-0.5 truncate">{a.name}</div>
                    <button onClick={() => {
                      const p = window.prompt("Who is this? (likeness only mixes same-person photos)", a.person);
                      if (p) patchAvatar(a.id, { person: p.trim().toLowerCase() }, (x) => ({ ...x, person: p.trim().toLowerCase() }));
                    }} className={`text-[8.5px] px-1 rounded ${a.person === "me" ? "bg-neutral-800 text-neutral-400" : "bg-amber-500/20 text-amber-400"}`}>{a.person}</button>
                    <div className="flex gap-1 text-[9px]">
                      {!a.is_default && <button onClick={() => { patchAvatar(a.id, { makeDefault: true }, (x) => ({ ...x, is_default: true })); setAvatarId(""); }} className="text-amber-400">★</button>}
                      {a.is_default && <span className="text-neutral-500">★</span>}
                      <button onClick={() => patchAvatar(a.id, { likeness: !a.use_for_likeness }, (x) => ({ ...x, use_for_likeness: !x.use_for_likeness }))}
                        className={a.use_for_likeness ? "text-green-400" : "text-neutral-500"}>👁</button>
                      <button onClick={async () => { if (window.confirm("Remove?")) { setAvatars((p) => p.filter((x) => x.id !== a.id)); await fetch(`/api/avatars?id=${a.id}`, { method: "DELETE" }); } }} className="text-neutral-500">×</button>
                    </div>
                  </div>
                );
              })}
              {!avatars.length && <div className="text-[11px] text-neutral-400 py-4">No avatars — add 2-3 cutout photos of yourself (different angles).</div>}
            </div>
          </div>
        )}

        <button onClick={generate} disabled={busy} className="w-full py-2.5 rounded-lg font-semibold bg-amber-500 text-black disabled:opacity-50">
          {busy ? "Generating… (~1-2 min)" : "Generate"}
        </button>
        {genErr && <div className="text-[12px] text-red-400">{genErr}</div>}
        {results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {results.map((src, i) => (
              <div key={i} className="relative group rounded-lg overflow-hidden border border-neutral-800">
                <img src={src} alt={`v${i + 1}`} className="w-full aspect-video object-cover" />
                <div className="absolute bottom-1.5 inset-x-1.5 flex justify-between opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => tweak(src)} className="px-2 py-1 rounded text-[11px] font-semibold bg-amber-500 text-black">Tweak this</button>
                  <a href={src} download={`thumbnail-${i + 1}.png`} className="px-2 py-1 rounded text-[11px] bg-black/70 text-white">Save</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── History ── */}
      {sessions.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
          <h2 className="text-[15px] font-bold">Past rounds</h2>
          {sessions.map((s) => (
            <div key={s.id} className="rounded-lg border border-neutral-800 p-3 cursor-pointer hover:border-neutral-700"
              onClick={() => { setResults(s.outputs); document.getElementById("gen-panel")?.scrollIntoView({ behavior: "smooth" }); }}>
              <div className="flex justify-between gap-2 mb-2">
                <div className="text-[12.5px] text-neutral-400">&ldquo;{s.instructions.slice(0, 110) || "(no instructions)"}&rdquo;</div>
                <button onClick={(e) => { e.stopPropagation(); setRefs(s.ref_images.slice(0, 6)); setInstructions(s.instructions); document.getElementById("gen-panel")?.scrollIntoView({ behavior: "smooth" }); }}
                  className="shrink-0 text-[11px] font-semibold text-amber-400">Reuse setup</button>
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {s.outputs.map((o, i) => (
                  <div key={i} className="relative group shrink-0">
                    <img src={o} alt="" className="h-20 aspect-video object-cover rounded border border-neutral-800" />
                    <button onClick={(e) => { e.stopPropagation(); tweak(o); }}
                      className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-amber-500 text-black opacity-0 group-hover:opacity-100">Tweak</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
