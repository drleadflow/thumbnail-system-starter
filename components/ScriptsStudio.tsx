"use client";

// Scripts — write video scripts, run the Hook Lab, or turn a voice note into a
// structured draft. Everything saved here grounds thumbnail generation.
import { useEffect, useRef, useState } from "react";

interface ScriptRow { id: string; title: string; topic: string; hook: string; source: string; created_at: string }
interface HookVideo { videoId: string; title: string; channel: string; views: number; publishedAt?: string | null; outlierRatio?: number | null; thumbnailUrl: string }
interface Variant { hook: string; mechanism: string; why: string }

const fmtV = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

export default function ScriptsStudio() {
  const [list, setList] = useState<ScriptRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [hook, setHook] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // hook lab
  const [hlVideos, setHlVideos] = useState<HookVideo[]>([]);
  const [hlHooks, setHlHooks] = useState<Record<string, string>>({});
  const [hlBusy, setHlBusy] = useState<string | null>(null);
  const [hlErr, setHlErr] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  // voice
  const [recState, setRecState] = useState<"idle" | "recording" | "working">("idle");
  const [recErr, setRecErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const loadList = () => fetch("/api/scripts").then((r) => r.json()).then((j) => setList(j.scripts || [])).catch(() => {});
  useEffect(() => { loadList(); }, []);

  async function open(id: string) {
    const j = await fetch(`/api/scripts?id=${id}`).then((r) => r.json());
    if (j.error) return setErr(j.error);
    setSel(id); setTitle(j.script.title || ""); setTopic(j.script.topic || ""); setHook(j.script.hook || ""); setContent(j.script.content || "");
  }

  async function save() {
    if (saving || !title.trim()) { if (!title.trim()) setErr("Give the script a title first."); return; }
    setSaving(true); setErr(null);
    const isNew = sel === "new";
    const j = await fetch("/api/scripts", {
      method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? { title, topic, hook, content } : { id: sel, title, topic, hook, content }),
    }).then((r) => r.json()).catch(() => ({ error: "save failed" }));
    if (j.error) setErr(j.error);
    else { if (isNew && j.id) setSel(j.id); setSaved(true); setTimeout(() => setSaved(false), 2000); loadList(); }
    setSaving(false);
  }

  // autosave 2.5s after last edit on an existing script
  useEffect(() => {
    if (sel === null || sel === "new") return;
    const t = setTimeout(save, 2500);
    return () => clearTimeout(t);
  }, [title, topic, hook, content]); // eslint-disable-line

  async function hlSearch() {
    const t = topic.trim().toLowerCase();
    if (!t) return setHlErr("Set the Topic field first.");
    setHlBusy("search"); setHlErr(null); setVariants([]);
    try {
      let j = await fetch(`/api/library?topic=${encodeURIComponent(t)}&sort=outlier`).then((r) => r.json());
      if (!(j.items || []).length) j = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: t }) }).then((r) => r.json());
      if (j.error) setHlErr(j.error);
      else setHlVideos((j.items || []).slice().sort((a: HookVideo, b: HookVideo) => (b.outlierRatio || 0) - (a.outlierRatio || 0)).slice(0, 6));
    } catch (e) { setHlErr(String(e)); } finally { setHlBusy(null); }
  }

  async function hlGetHooks() {
    setHlBusy("hooks"); setHlErr(null);
    const j = await fetch("/api/hooks", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videos: hlVideos.map((v) => ({ videoId: v.videoId, title: v.title, channel: v.channel })) }) }).then((r) => r.json()).catch(() => ({ error: "failed" }));
    if (j.error) setHlErr(j.error); else setHlHooks(j.hooks || {});
    setHlBusy(null);
  }

  async function hlOptimize() {
    if (!hook.trim()) return setHlErr("Write your draft hook first — even one rough sentence.");
    setHlBusy("optimize"); setHlErr(null); setVariants([]);
    const refs = hlVideos.filter((v) => hlHooks[v.videoId]).map((v) => ({ hook: hlHooks[v.videoId], title: v.title, channel: v.channel, outlierRatio: v.outlierRatio }));
    const j = await fetch("/api/hook-optimize", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: hook, title, topic, refs }) }).then((r) => r.json()).catch(() => ({ error: "failed" }));
    if (j.error) setHlErr(j.error); else setVariants(j.variants || []);
    setHlBusy(null);
  }

  async function record() {
    if (recState === "recording") { recRef.current?.stop(); return; }
    setRecErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecState("working");
        const fd = new FormData();
        fd.append("audio", new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }), "voice-note.webm");
        const j = await fetch("/api/voice-draft", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ error: "failed" }));
        if (j.error) setRecErr(j.error); else { await loadList(); await open(j.scriptId); }
        setRecState("idle");
      };
      recRef.current = mr; mr.start(); setRecState("recording");
    } catch { setRecErr("Mic access denied — allow the microphone and try again."); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 space-y-2">
        <button onClick={() => { setSel("new"); setTitle(""); setTopic(""); setHook(""); setContent(""); }}
          className="w-full py-2 rounded-md text-[13px] font-semibold bg-amber-500 text-black">+ New script</button>
        <button onClick={record} disabled={recState === "working"}
          className={`w-full py-2 rounded-md text-[13px] font-semibold border ${recState === "recording" ? "bg-red-700 text-white border-red-700" : "border-amber-500/40 text-amber-400"} disabled:opacity-60`}>
          {recState === "recording" ? "■ Stop recording" : recState === "working" ? "Structuring your draft…" : "🎙 Voice note → draft"}
        </button>
        {recErr && <div className="text-[11px] text-red-400 px-1">{recErr}</div>}
        <div className="space-y-1 max-h-[65vh] overflow-y-auto">
          {list.map((s) => (
            <div key={s.id} onClick={() => open(s.id)}
              className={`px-2.5 py-2 rounded-md cursor-pointer ${sel === s.id ? "bg-amber-500/10 border border-amber-500/30" : ""}`}>
              <div className="text-[12.5px] font-medium leading-snug">{s.title}</div>
              <div className="text-[10.5px] text-neutral-500">{s.source} · {new Date(s.created_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-3">
        {sel === null ? (
          <div className="py-16 text-center text-[13px] text-neutral-400">Pick a script, start a new one, or record a voice note.</div>
        ) : (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Working title — as it'll appear on YouTube…"
              className="w-full px-3 py-2 rounded-md text-[15px] font-semibold bg-neutral-900 border border-neutral-800 outline-none" />
            <div className="grid md:grid-cols-2 gap-3">
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (what gets researched)"
                className="px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
              <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="The hook — your first 30 seconds…"
                className="px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={16} placeholder="Write the script — markdown welcome…"
              className="w-full px-3 py-2.5 rounded-md text-[13.5px] leading-relaxed bg-neutral-900 border border-neutral-800 outline-none resize-y" />
            {err && <div className="text-[12px] text-red-400">{err}</div>}
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-md text-[13px] font-semibold bg-amber-500 text-black disabled:opacity-60">
              {saved ? "✓ Saved" : sel === "new" ? "Save script" : "Save changes"}
            </button>

            {/* Hook Lab */}
            <div className="rounded-lg border border-amber-500/30 p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[13px] font-semibold">Hook Lab</div>
                  <div className="text-[11px] text-neutral-400">Top videos → their real spoken openings → your hook, rebuilt on the winning mechanics.</div>
                </div>
                <div className="flex gap-2 text-[12px] font-semibold">
                  <button onClick={hlSearch} disabled={!!hlBusy} className="px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-400 disabled:opacity-50">{hlBusy === "search" ? "…" : "Find top videos"}</button>
                  {hlVideos.length > 0 && <button onClick={hlGetHooks} disabled={!!hlBusy} className="px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-400 disabled:opacity-50">{hlBusy === "hooks" ? "…" : "Get their hooks"}</button>}
                  {Object.keys(hlHooks).length > 0 && <button onClick={hlOptimize} disabled={!!hlBusy} className="px-3 py-1.5 rounded-md bg-amber-500 text-black disabled:opacity-50">{hlBusy === "optimize" ? "…" : "Optimize my hook"}</button>}
                </div>
              </div>
              {hlErr && <div className="text-[11.5px] text-red-400">{hlErr}</div>}
              {hlVideos.map((v) => (
                <div key={v.videoId} className="flex gap-2.5 rounded-md p-2 bg-neutral-900 border border-neutral-800">
                  <img src={v.thumbnailUrl} alt="" className="w-[88px] aspect-video object-cover rounded shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold truncate">
                      {typeof v.outlierRatio === "number" && v.outlierRatio >= 2 && <span className="text-green-400 mr-1">{v.outlierRatio}x</span>}{v.title}
                    </div>
                    <div className="text-[10px] text-neutral-500">{v.channel} · {fmtV(v.views)} views</div>
                    {hlHooks[v.videoId] !== undefined && (
                      <div className="text-[11px] mt-1 text-neutral-400 leading-snug">{hlHooks[v.videoId] ? `“${hlHooks[v.videoId].slice(0, 280)}…”` : "(no transcript)"}</div>
                    )}
                  </div>
                </div>
              ))}
              {variants.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10.5px] uppercase tracking-widest text-amber-400">Your hook, rebuilt — click one to use it</div>
                  {variants.map((v, i) => (
                    <button key={i} onClick={() => { setHook(v.hook); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="w-full text-left rounded-md p-2.5 bg-neutral-900 border border-amber-500/20 hover:border-amber-500/50">
                      <div className="text-[12.5px]">{v.hook}</div>
                      <div className="text-[10.5px] mt-1 text-neutral-400"><b className="text-amber-400">{v.mechanism}</b> · {v.why}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
