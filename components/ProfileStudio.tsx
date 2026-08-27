"use client";

// Creator Profile — the onboarding that kills slop. Everything saved here is
// injected into every AI feature: ideas, hooks, analysis, rewrites, drafts.
import { useEffect, useState } from "react";

const FIELDS: { key: string; label: string; hint: string; rows?: number }[] = [
  { key: "name", label: "Your name", hint: "How the AI should refer to you." },
  { key: "one_liner", label: "What you do — one sentence", hint: "e.g. \"I'm a physician who teaches health professionals to grow their practice with AI.\"" },
  { key: "business_model", label: "Business model", hint: "How the content makes money — community, services, products, ads…" },
  { key: "audience", label: "Who watches", hint: "Who they are, what they want, what they already know.", rows: 2 },
  { key: "pillars", label: "Content pillars", hint: "The 3-5 themes you actually make videos about.", rows: 2 },
  { key: "never_talk_about", label: "Never talk about", hint: "Hard exclusions — topics the AI must never suggest. As important as the pillars.", rows: 2 },
  { key: "beliefs", label: "Your point of view", hint: "The opinions and beliefs that make your content YOURS — what you'd argue for, what you think everyone gets wrong.", rows: 3 },
  { key: "subreddits", label: "Subreddits to watch", hint: "Comma-separated, e.g. \"NewTubers, Entrepreneur\" — where your audience talks candidly. Feeds the Idea Engine (free, no key needed).", rows: 1 },
];

export default function ProfileStudio() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then((j) => { if (j.profile) setValues(j.profile); }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setErr(null);
    const j = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) })
      .then((r) => r.json()).catch(() => ({ error: "save failed" }));
    if (j.error) setErr(j.error); else { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    setSaving(false);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-[18px] font-bold">Creator Profile</h1>
        <p className="text-[13px] text-neutral-400 mt-1">
          The single biggest difference between useful output and slop is this page. Everything here is injected into every AI feature — ideas, hooks, analysis, drafts. Ten minutes now upgrades everything forever, and the &ldquo;never talk about&rdquo; line matters as much as the pillars.
        </p>
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <div className="text-[12px] font-semibold mb-0.5">{f.label}</div>
            <div className="text-[11px] text-neutral-500 mb-1.5">{f.hint}</div>
            {f.rows && f.rows > 1 ? (
              <textarea value={values[f.key] || ""} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} rows={f.rows}
                className="w-full px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none resize-y" />
            ) : (
              <input value={values[f.key] || ""} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                className="w-full px-3 py-2 rounded-md text-[13px] bg-neutral-900 border border-neutral-800 outline-none" />
            )}
          </div>
        ))}
        {err && <div className="text-[12px] text-red-400">{err}</div>}
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-md text-[13px] font-semibold bg-amber-500 text-black disabled:opacity-60">
          {saved ? "✓ Saved — every AI feature now knows you" : saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}
