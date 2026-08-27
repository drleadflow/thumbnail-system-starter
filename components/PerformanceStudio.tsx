"use client";

// My Videos — the calibration loop. Your published videos scored against YOUR
// channel's own normal, and an honest read on what your winners share.
import { useEffect, useState } from "react";

interface Pub { id: string; video_id: string; title: string; views: number; likes: number; comments: number; my_outlier: number | null; published_at: string | null; thumbnail_url: string; script_id: string | null }
interface Calibration { winners_share: string[]; double_down: string[]; drop: string[]; next_test: string; confidence: string }

const fmtV = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

export default function PerformanceStudio() {
  const [videos, setVideos] = useState<Pub[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [calBusy, setCalBusy] = useState(false);

  const load = () => fetch("/api/published").then((r) => r.json()).then((j) => { if (!j.error) setVideos(j.videos || []); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!url.trim() || busy) return;
    setBusy(true); setErr(null);
    const j = await fetch("/api/published", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
      .then((r) => r.json()).catch(() => ({ error: "add failed" }));
    if (j.error) setErr(j.error); else { setUrl(""); load(); }
    setBusy(false);
  }

  async function calibrate() {
    setCalBusy(true); setErr(null);
    const j = await fetch("/api/calibration", { method: "POST" }).then((r) => r.json()).catch(() => ({ error: "calibration failed" }));
    if (j.error) setErr(j.error); else setCal(j.calibration);
    setCalBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold">My Videos</h1>
          <p className="text-[13px] text-neutral-400 mt-0.5">Your published videos, scored against <b>your own channel&rsquo;s normal</b> — and what your winners actually share. Stats refresh themselves.</p>
        </div>
        {videos.length >= 3 && (
          <button onClick={calibrate} disabled={calBusy} className="px-4 py-2.5 rounded-lg text-[13.5px] font-semibold bg-amber-500 text-black disabled:opacity-60">
            {calBusy ? "Analyzing your results…" : "🎯 What's working for me?"}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Paste a YouTube URL of one of YOUR published videos…"
          className="flex-1 px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
        <button onClick={add} disabled={busy || !url.trim()} className="px-4 py-2 rounded-md text-[13px] font-semibold bg-amber-500 text-black disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
      </div>
      {err && <div className="text-[12.5px] text-red-400">{err}</div>}

      {cal && (
        <div className="rounded-xl border border-green-500/25 bg-neutral-950 p-4 space-y-3">
          <div className="text-[10.5px] uppercase tracking-widest text-green-400">Calibration — from your real results</div>
          <div>
            <div className="text-[12px] font-semibold mb-1">Your winners share:</div>
            <ul className="space-y-1">{cal.winners_share?.map((x, i) => <li key={i} className="text-[12.5px] text-neutral-200">• {x}</li>)}</ul>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-md bg-neutral-900 border border-green-500/20 p-2.5">
              <div className="text-[11px] font-semibold text-green-400 mb-1">Double down</div>
              <ul className="space-y-1">{cal.double_down?.map((x, i) => <li key={i} className="text-[12px] text-neutral-300">• {x}</li>)}</ul>
            </div>
            <div className="rounded-md bg-neutral-900 border border-red-500/20 p-2.5">
              <div className="text-[11px] font-semibold text-red-400 mb-1">Drop</div>
              <ul className="space-y-1">{cal.drop?.map((x, i) => <li key={i} className="text-[12px] text-neutral-300">• {x}</li>)}</ul>
            </div>
          </div>
          {cal.next_test && <div className="text-[12.5px] text-amber-300"><b>Next test:</b> {cal.next_test}</div>}
          {cal.confidence && <div className="text-[11px] text-neutral-500">{cal.confidence}</div>}
        </div>
      )}

      {videos.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-3">
          {videos.map((v) => (
            <div key={v.id} className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
              <div className="relative">
                <img src={v.thumbnail_url} alt="" className="w-full aspect-video object-cover" />
                {typeof v.my_outlier === "number" && (
                  <span className={`absolute top-1.5 right-1.5 text-[11px] font-extrabold px-2 py-0.5 rounded ${v.my_outlier >= 2 ? "bg-green-600 text-white" : v.my_outlier >= 0.8 ? "bg-black/70 text-neutral-200" : "bg-red-600/90 text-white"}`}>
                    {v.my_outlier}x me
                  </span>
                )}
              </div>
              <div className="p-2.5 space-y-1">
                <div className="text-[12px] font-semibold leading-snug line-clamp-2">{v.title}</div>
                <div className="text-[11px] text-neutral-400">{fmtV(v.views)} views · {fmtV(v.likes)} likes · {fmtV(v.comments)} comments{v.published_at ? ` · ${String(v.published_at).slice(0, 10)}` : ""}</div>
                <button onClick={async () => { if (window.confirm("Remove from tracking?")) { await fetch(`/api/published?id=${v.id}`, { method: "DELETE" }); load(); } }}
                  className="text-[10.5px] text-neutral-600">remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-[13px] text-neutral-500">
          Paste the URLs of your recent uploads. After 3+, &ldquo;What&rsquo;s working for me?&rdquo; finds the patterns in your own results — the part no competitor research can give you.
        </div>
      )}
    </div>
  );
}
