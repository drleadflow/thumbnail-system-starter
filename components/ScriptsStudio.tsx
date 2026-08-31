"use client";

// Scripts — write video scripts, run the Hook Lab, or turn a voice note into a
// structured draft. Everything saved here grounds thumbnail generation.
import { useEffect, useRef, useState } from "react";
import { drawScoreCard } from "@/lib/scoreCard";

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
  // ── Blueprint wizard ──
  interface Beat { name: string; purpose: string; instruction: string; placeholder: string }
  interface Blueprint { id: string; name: string; description: string; beats: Beat[]; uses: number; published_count?: number; avg_my_outlier?: number | null }
  const [bpOpen, setBpOpen] = useState(false);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [bpSel, setBpSel] = useState<Blueprint | null>(null);
  const [bpRefs, setBpRefs] = useState("");
  const [bpTopic, setBpTopic] = useState("");
  const [bpQuestions, setBpQuestions] = useState<string[]>([]);
  const [bpAnswers, setBpAnswers] = useState<string[]>([]);
  const [bpBusy, setBpBusy] = useState<string | null>(null);
  const [bpErr, setBpErr] = useState<string | null>(null);
  const [bpProbed, setBpProbed] = useState(false);
  const [bpProbeFrom, setBpProbeFrom] = useState(0); // index where follow-ups start

  const loadBlueprints = () => fetch("/api/blueprints").then((r) => r.json()).then((j) => setBlueprints(j.blueprints || [])).catch(() => {});

  async function distill() {
    const urls = bpRefs.split(/[\n,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (urls.length < 2) { setBpErr("Paste at least 2 YouTube URLs (one per line)."); return; }
    setBpBusy("distill"); setBpErr(null);
    const j = await fetch("/api/blueprints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }) })
      .then((r) => r.json()).catch(() => ({ error: "distillation failed" }));
    if (j.error) setBpErr(j.error); else { setBpRefs(""); await loadBlueprints(); setBpSel(j.blueprint); }
    setBpBusy(null);
  }

  async function startInterview() {
    if (!bpSel || !bpTopic.trim()) { setBpErr("Pick a blueprint and give your topic."); return; }
    setBpBusy("interview"); setBpErr(null); setBpQuestions([]);
    const j = await fetch("/api/blueprint-script", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blueprintId: bpSel.id, topic: bpTopic, mode: "interview" }) }).then((r) => r.json()).catch(() => ({ error: "failed" }));
    if (j.error) setBpErr(j.error); else { setBpQuestions(j.questions || []); setBpAnswers(new Array((j.questions || []).length).fill("")); setBpProbed(false); setBpProbeFrom(0); }
    setBpBusy(null);
  }

  // Round 2: dig where answers are too thin to write from, then assemble.
  async function probeThenAssemble() {
    const qa = bpQuestions.map((q, i) => ({ q, a: bpAnswers[i] || "" })).filter((x) => x.a.trim());
    if (!qa.length) { setBpErr("Answer at least one question."); return; }
    if (!bpProbed) {
      setBpBusy("probe"); setBpErr(null);
      const j = await fetch("/api/blueprint-script", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blueprintId: bpSel!.id, topic: bpTopic, mode: "probe", qa }) }).then((r) => r.json()).catch(() => ({ followups: [] }));
      setBpProbed(true);
      const fu: string[] = Array.isArray(j.followups) ? j.followups : [];
      setBpBusy(null);
      if (fu.length) {
        setBpProbeFrom(bpQuestions.length);
        setBpQuestions((prev) => [...prev, ...fu]);
        setBpAnswers((prev) => [...prev, ...new Array(fu.length).fill("")]);
        return; // show round 2; next click assembles
      }
    }
    await assemble();
  }

  async function assemble() {
    const qa = bpQuestions.map((q, i) => ({ q, a: bpAnswers[i] || "" })).filter((x) => x.a.trim());
    if (!qa.length) { setBpErr("Answer at least one question."); return; }
    setBpBusy("assemble"); setBpErr(null);
    const j = await fetch("/api/blueprint-script", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blueprintId: bpSel!.id, topic: bpTopic, qa }) }).then((r) => r.json()).catch(() => ({ error: "assembly failed" }));
    if (j.error) setBpErr(j.error);
    else {
      setBpOpen(false); setBpQuestions([]); setBpTopic(""); setBpSel(null); setBpProbed(false); setBpProbeFrom(0);
      await loadList(); await open(j.scriptId);
    }
    setBpBusy(null);
  }

  // voice
  const [recState, setRecState] = useState<"idle" | "recording" | "working">("idle");
  // transcript modal + analyzer
  const [modal, setModal] = useState<{ videoId: string; title: string; channel: string; hook: string; full: string; loading: boolean } | null>(null);
  interface Analysis { scores: Record<string, number>; patterns_in_winners: string[]; whats_missing: { pattern: string; current: string; fix: string }[]; verdict: string }
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [winnersUsed, setWinnersUsed] = useState(0);
  const [rewrite, setRewrite] = useState<{ hook: string; opening: string; changes: string[] } | null>(null);
  const [rewriteBusy, setRewriteBusy] = useState(false);
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

  async function openTranscript(v: HookVideo) {
    setModal({ videoId: v.videoId, title: v.title, channel: v.channel, hook: hlHooks[v.videoId] || "", full: "", loading: true });
    const j = await fetch(`/api/hooks?videoId=${v.videoId}`).then((r) => r.json()).catch(() => ({ error: "failed" }));
    setModal((m) => m && m.videoId === v.videoId
      ? { ...m, hook: j.hook || m.hook, full: j.fullTranscript || "", loading: false }
      : m);
  }

  async function analyze() {
    if (analysisBusy) return;
    setAnalysisBusy(true); setAnalysis(null); setHlErr(null);
    const j = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, hook, content }),
    }).then((r) => r.json()).catch(() => ({ error: "analysis failed" }));
    if (j.error) setHlErr(j.error); else { setAnalysis(j.analysis); setWinnersUsed(j.winnersUsed || 0); setRewrite(null); }
    setAnalysisBusy(false);
  }

  async function rewriteOpening() {
    if (rewriteBusy || !analysis) return;
    setRewriteBusy(true); setHlErr(null);
    const j = await fetch("/api/rewrite-opening", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, hook, content, fixes: analysis.whats_missing || [] }),
    }).then((r) => r.json()).catch(() => ({ error: "rewrite failed" }));
    if (j.error) setHlErr(j.error); else setRewrite(j);
    setRewriteBusy(false);
  }

  function shareCard() {
    if (!analysis) return;
    const url = drawScoreCard({ title, topic, scores: analysis.scores || {}, verdict: analysis.verdict || "", winnersUsed });
    const a = document.createElement("a");
    a.href = url;
    a.download = "script-analysis.png";
    a.click();
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
        <button onClick={() => { setBpOpen(true); loadBlueprints(); }}
          className="w-full py-2 rounded-md text-[13px] font-semibold border border-amber-500/40 text-amber-400">
          📐 New from blueprint
        </button>
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
                  <button onClick={analyze} disabled={analysisBusy} className="px-3 py-1.5 rounded-md border border-green-500/40 text-green-400 disabled:opacity-50">{analysisBusy ? "Analyzing…" : "Analyze my script"}</button>
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
                      <div className="text-[11px] mt-1 text-neutral-400 leading-snug">
                        {hlHooks[v.videoId] ? <>&ldquo;{hlHooks[v.videoId].slice(0, 550)}{hlHooks[v.videoId].length > 550 ? "…" : ""}&rdquo;</> : "(no transcript)"}
                      </div>
                    )}
                    <button onClick={() => openTranscript(v)} className="text-[10.5px] font-semibold text-amber-400 mt-1">Read their full opening →</button>
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
              {analysis && (
                <div className="space-y-3 rounded-lg border border-green-500/25 p-3">
                  <div className="text-[10.5px] uppercase tracking-widest text-green-400">Script analysis — vs what actually won on this topic</div>
                  <div className="grid grid-cols-5 gap-2">
                    {Object.entries(analysis.scores || {}).map(([k, v]) => (
                      <div key={k} className="text-center">
                        <div className={`text-[18px] font-extrabold ${v >= 7 ? "text-green-400" : v >= 5 ? "text-amber-400" : "text-red-400"}`}>{v}</div>
                        <div className="text-[9px] uppercase tracking-wide text-neutral-500">{k.replace(/_/g, " ")}</div>
                      </div>
                    ))}
                  </div>
                  {(analysis.patterns_in_winners || []).length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold mb-1">What the winners do:</div>
                      <ul className="space-y-1">{analysis.patterns_in_winners.map((x, i) => <li key={i} className="text-[11.5px] text-neutral-300 leading-snug">• {x}</li>)}</ul>
                    </div>
                  )}
                  {(analysis.whats_missing || []).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold">What yours is missing:</div>
                      {analysis.whats_missing.map((x, i) => (
                        <div key={i} className="rounded-md bg-neutral-900 border border-neutral-800 p-2">
                          <div className="text-[11.5px] font-semibold text-amber-400">{x.pattern}</div>
                          <div className="text-[11px] text-neutral-400 mt-0.5">Now: {x.current}</div>
                          <div className="text-[11px] text-green-400 mt-0.5">Fix: {x.fix}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {analysis.verdict && <div className="text-[12px] text-neutral-200 border-t border-neutral-800 pt-2">{analysis.verdict}</div>}
                  <div className="flex gap-2 flex-wrap pt-1">
                    <button onClick={rewriteOpening} disabled={rewriteBusy}
                      className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-green-600 text-white disabled:opacity-50">
                      {rewriteBusy ? "Rewriting…" : "✍️ Rewrite my opening with these fixes"}
                    </button>
                    <button onClick={shareCard} className="px-3 py-1.5 rounded-md text-[12px] font-semibold border border-neutral-700 text-neutral-300">
                      📸 Download score card
                    </button>
                  </div>
                  {rewrite && (
                    <div className="rounded-lg bg-neutral-900 border border-green-500/30 p-3 space-y-2">
                      <div className="text-[10.5px] uppercase tracking-widest text-green-400">Your new opening — fixes applied</div>
                      <div className="text-[13.5px] leading-relaxed text-neutral-100">{rewrite.opening}</div>
                      {rewrite.changes?.length > 0 && (
                        <ul className="space-y-0.5">{rewrite.changes.map((c, i) => <li key={i} className="text-[11px] text-neutral-400">• {c}</li>)}</ul>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => { setHook(rewrite.hook || rewrite.opening.split(". ").slice(0, 2).join(". ")); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-amber-500 text-black">Use as my hook</button>
                        <button onClick={() => navigator.clipboard.writeText(rewrite.opening)} className="px-3 py-1.5 rounded-md text-[12px] border border-neutral-700 text-neutral-300">Copy opening</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Blueprint wizard ── */}
      {bpOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setBpOpen(false)}>
          <div className="bg-neutral-950 border border-neutral-700 rounded-xl max-w-2xl w-full max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <div className="text-[14px] font-bold">New script from a blueprint</div>
              <button onClick={() => setBpOpen(false)} className="text-neutral-400 text-[18px] leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4">
              {bpErr && <div className="text-[12px] text-red-400">{bpErr}</div>}

              {!bpQuestions.length && (
                <>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-amber-400 mb-1.5">1 · Pick a structure</div>
                    {blueprints.length ? (
                      <div className="space-y-1.5">
                        {blueprints.map((b) => (
                          <button key={b.id} onClick={() => setBpSel(b)}
                            className={`w-full text-left rounded-md p-2.5 border ${bpSel?.id === b.id ? "border-amber-500/60 bg-amber-500/5" : "border-neutral-800"}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-semibold">{b.name}</span>
                              <span className="text-[10.5px] text-neutral-500">
                                {b.beats?.length || 0} beats · used {b.uses}x{typeof b.avg_my_outlier === "number" ? ` · avg ${b.avg_my_outlier}x your normal` : ""}
                              </span>
                            </div>
                            <div className="text-[11.5px] text-neutral-400">{b.description}</div>
                          </button>
                        ))}
                      </div>
                    ) : <div className="text-[12px] text-neutral-500">No blueprints yet — build your first one below.</div>}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-amber-400 mb-1.5">…or build one from winners</div>
                    <textarea value={bpRefs} onChange={(e) => setBpRefs(e.target.value)} rows={3}
                      placeholder={"Paste 2-5 YouTube URLs of videos whose STRUCTURE you want — one per line.\nTip: use your library's top outliers."}
                      className="w-full px-3 py-2 rounded-md text-[12.5px] bg-neutral-900 border border-neutral-800 outline-none" />
                    <button onClick={distill} disabled={bpBusy === "distill"} className="mt-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold border border-amber-500/40 text-amber-400 disabled:opacity-50">
                      {bpBusy === "distill" ? "Reading all of them + distilling… (~1-2 min)" : "Distill blueprint"}
                    </button>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-amber-400 mb-1.5">2 · Your topic</div>
                    <input value={bpTopic} onChange={(e) => setBpTopic(e.target.value)} placeholder="What's this video about?"
                      className="w-full px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
                  </div>
                  <button onClick={startInterview} disabled={!bpSel || !bpTopic.trim() || bpBusy === "interview"}
                    className="w-full py-2.5 rounded-lg text-[13.5px] font-semibold bg-amber-500 text-black disabled:opacity-50">
                    {bpBusy === "interview" ? "Preparing your interview…" : "Start the interview →"}
                  </button>
                </>
              )}

              {bpQuestions.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-widest text-amber-400">3 · The interview — your real material, so nothing gets invented</div>
                  {bpQuestions.map((q, i) => (
                    <div key={i}>
                      {bpProbeFrom > 0 && i === bpProbeFrom && (
                        <div className="text-[10.5px] uppercase tracking-widest mt-2 mb-1.5 text-amber-400">Round 2 · your answers above were thin here — the stories below are what make the script good</div>
                      )}
                      <div className="text-[12.5px] font-semibold mb-1">{i + 1}. {q}</div>
                      <textarea value={bpAnswers[i] || ""} onChange={(e) => setBpAnswers((p) => p.map((a, x) => (x === i ? e.target.value : a)))} rows={2}
                        placeholder="Talk like you'd talk — rough is fine. Leave blank to get a [placeholder] instead."
                        className="w-full px-3 py-2 rounded-md text-[12.5px] bg-neutral-900 border border-neutral-800 outline-none" />
                    </div>
                  ))}
                  <button onClick={probeThenAssemble} disabled={bpBusy === "assemble" || bpBusy === "probe"}
                    className="w-full py-2.5 rounded-lg text-[13.5px] font-semibold bg-amber-500 text-black disabled:opacity-50">
                    {bpBusy === "assemble" ? "Drafting, then a craft pass…" : bpBusy === "probe" ? "Checking where to dig deeper…" : bpProbed ? "Assemble my script" : "Continue →"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Transcript modal ── */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className="bg-neutral-950 border border-neutral-700 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-4 border-b border-neutral-800">
              <div>
                <div className="text-[14px] font-bold leading-snug">{modal.title}</div>
                <div className="text-[11px] text-neutral-500">{modal.channel} · how this video actually opens</div>
              </div>
              <button onClick={() => setModal(null)} className="text-neutral-400 text-[18px] leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4">
              {modal.loading ? <div className="text-[12px] text-neutral-400 py-6 text-center">Loading transcript…</div> : (
                <>
                  <div>
                    <div className="text-[10.5px] uppercase tracking-widest text-amber-400 mb-1.5">The first minute — this is the hook</div>
                    <div className="text-[13.5px] leading-relaxed text-neutral-100 bg-neutral-900 border border-amber-500/25 rounded-lg p-3">{modal.hook || "(no transcript available)"}</div>
                    {modal.hook && <button onClick={() => navigator.clipboard.writeText(modal.hook)} className="text-[10.5px] text-amber-400 mt-1.5">Copy first minute</button>}
                  </div>
                  {modal.full && modal.full.length > modal.hook.length + 50 && (
                    <div>
                      <div className="text-[10.5px] uppercase tracking-widest text-neutral-500 mb-1.5">Full transcript</div>
                      <div className="text-[12px] leading-relaxed text-neutral-400 whitespace-pre-wrap">{modal.full}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
