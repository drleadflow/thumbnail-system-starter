"use client";

// The Idea Engine — research-backed video ideas from YOUR evidence: watchlist
// outliers, topic research, and Reddit. Each idea shows its receipts, and is
// one click from a script or from filming ammo.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Evidence { type: string; source: string; detail: string }
interface Idea { id: string; title: string; angle: string; why_you: string; evidence: Evidence[]; status: string; created_at: string }

export default function IdeasStudio() {
  const router = useRouter();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ammoFor, setAmmoFor] = useState<string | null>(null);
  const [ammo, setAmmo] = useState<Record<string, string[]>>({});
  const [profileSet, setProfileSet] = useState(true);

  const load = () => fetch("/api/ideas").then((r) => r.json()).then((j) => setIdeas(j.ideas || [])).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/profile").then((r) => r.json()).then((j) => setProfileSet(Boolean(j.profile?.one_liner || j.profile?.pillars))).catch(() => {});
  }, []);

  async function generate() {
    if (busy) return;
    setBusy(true); setErr(null);
    const j = await fetch("/api/ideas", { method: "POST" }).then((r) => r.json()).catch(() => ({ error: "generation failed" }));
    if (j.error) setErr(j.error); else load();
    setBusy(false);
  }

  async function setStatus(id: string, status: string) {
    setIdeas((p) => status === "dismissed" ? p.filter((i) => i.id !== id) : p.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch("/api/ideas", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) }).catch(() => {});
  }

  async function makeScript(idea: Idea) {
    const j = await fetch("/api/scripts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: idea.title, topic: idea.title.toLowerCase().split(" ").slice(0, 6).join(" "), hook: "", content: `## Angle\n${idea.angle}\n\n## Why me\n${idea.why_you}\n\n## Evidence\n${idea.evidence.map((e) => `- [${e.type}] ${e.source}: ${e.detail}`).join("\n")}\n\n## Script\n`, source: "idea" }),
    }).then((r) => r.json()).catch(() => ({ error: "failed" }));
    if (j.error) { setErr(j.error); return; }
    await setStatus(idea.id, "scripted");
    router.push("/scripts");
  }

  async function getAmmo(idea: Idea) {
    setAmmoFor(idea.id); setErr(null);
    const j = await fetch("/api/ammo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ideaId: idea.id }) })
      .then((r) => r.json()).catch(() => ({ error: "ammo failed" }));
    if (j.error) setErr(j.error); else setAmmo((p) => ({ ...p, [idea.id]: j.points || [] }));
    setAmmoFor(null);
  }

  const fresh = ideas.filter((i) => i.status === "new");
  const saved = ideas.filter((i) => i.status === "saved" || i.status === "scripted");

  const Card = ({ idea }: { idea: Idea }) => (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[14.5px] font-bold leading-snug">{idea.title}</div>
        {idea.status === "scripted" && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-600/20 text-green-400 font-semibold">SCRIPTED</span>}
      </div>
      <div className="text-[12.5px] text-neutral-300 leading-snug">{idea.angle}</div>
      {idea.why_you && <div className="text-[11.5px] text-amber-400/90">Why you: {idea.why_you}</div>}
      {idea.evidence?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {idea.evidence.map((e, i) => (
            <span key={i} className="text-[10.5px] px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400" title={e.detail}>
              {e.type === "reddit" ? "💬" : e.type === "cross-signal" ? "⚡" : "📈"} {e.source}: {e.detail.slice(0, 60)}{e.detail.length > 60 ? "…" : ""}
            </span>
          ))}
        </div>
      )}
      {ammo[idea.id] && (
        <div className="rounded-md bg-neutral-900 border border-amber-500/25 p-2.5">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 mb-1">Ammo — riff on these</div>
          <ul className="space-y-1">{ammo[idea.id].map((p, i) => <li key={i} className="text-[12px] text-neutral-200">• {p}</li>)}</ul>
        </div>
      )}
      <div className="flex gap-2 flex-wrap pt-1 text-[12px] font-semibold">
        <button onClick={() => makeScript(idea)} className="px-3 py-1.5 rounded-md bg-amber-500 text-black">Make script →</button>
        <button onClick={() => getAmmo(idea)} disabled={ammoFor === idea.id} className="px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-400 disabled:opacity-50">
          {ammoFor === idea.id ? "…" : ammo[idea.id] ? "More ammo" : "Give me ammo"}
        </button>
        {idea.status === "new" && <button onClick={() => setStatus(idea.id, "saved")} className="px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300">Save</button>}
        <button onClick={() => setStatus(idea.id, "dismissed")} className="px-3 py-1.5 rounded-md text-neutral-500">Dismiss</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold">Idea Engine</h1>
          <p className="text-[13px] text-neutral-400 mt-0.5">10 video ideas backed by your watchlist&rsquo;s outliers, your research, and what Reddit is actually talking about — never from thin air.</p>
        </div>
        <button onClick={generate} disabled={busy} className="px-4 py-2.5 rounded-lg text-[13.5px] font-semibold bg-amber-500 text-black disabled:opacity-60">
          {busy ? "Researching + generating… (~1 min)" : "⚡ Generate 10 ideas"}
        </button>
      </div>
      {!profileSet && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12.5px] text-amber-300">
          Your <a href="/profile" className="underline font-semibold">Profile</a> is empty — ideas will be generic until the engine knows who you are. Two minutes there is the highest-leverage thing you can do.
        </div>
      )}
      {err && <div className="text-[12.5px] text-red-400">{err}</div>}
      {fresh.length > 0 && <div className="grid gap-3 md:grid-cols-2">{fresh.map((i) => <Card key={i.id} idea={i} />)}</div>}
      {saved.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-widest text-neutral-500">Saved &amp; scripted</div>
          <div className="grid gap-3 md:grid-cols-2">{saved.map((i) => <Card key={i.id} idea={i} />)}</div>
        </div>
      )}
      {!ideas.length && !busy && (
        <div className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-[13px] text-neutral-500">
          No ideas yet. Track a few channels in Thumbnails, fill your Profile, then hit Generate.
        </div>
      )}
    </div>
  );
}
