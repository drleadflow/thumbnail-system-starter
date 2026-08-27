// Blueprints — evolving script structures distilled from winning videos.
//   GET                      → list with evolution stats (uses + avg my-outlier of
//                              published videos made from each blueprint)
//   POST { urls: [] }        → distill ONE blueprint from 2-5 reference videos
//   POST { scriptIds: [] }   → distill from your own past scripts
//   DELETE ?id=
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { fetchTranscript } from "@/lib/scrapeCreators";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 300;

function parseVideoId(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{6,20})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : "";
}

async function oembed(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { title: "", channel: "" };
    const d = await r.json();
    return { title: String(d.title || "").slice(0, 200), channel: String(d.author_name || "").slice(0, 120) };
  } catch { return { title: "", channel: "" }; }
}

export async function GET() {
  const d = db();
  const { data: bps, error } = await d.from("blueprints").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Evolution stats: scripts made from each blueprint → their published results.
  const { data: scripts } = await d.from("scripts").select("id, blueprint_id").neq("blueprint_id", "");
  const { data: pubs } = await d.from("published_videos").select("script_id, my_outlier");
  const outByScript = new Map((pubs || []).filter((p) => p.script_id && p.my_outlier !== null).map((p) => [p.script_id, Number(p.my_outlier)]));
  const stats = new Map<string, number[]>();
  for (const s of scripts || []) {
    if (!s.blueprint_id) continue;
    const o = outByScript.get(s.id);
    if (o !== undefined) { const arr = stats.get(s.blueprint_id) || []; arr.push(o); stats.set(s.blueprint_id, arr); }
  }
  return NextResponse.json({
    ok: true,
    blueprints: (bps || []).map((b) => {
      const outs = stats.get(b.id) || [];
      return { ...b, published_count: outs.length, avg_my_outlier: outs.length ? Math.round((outs.reduce((a, x) => a + x, 0) / outs.length) * 100) / 100 : null };
    }),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const d = db();
  const sources: { label: string; transcript: string; weight: string }[] = [];
  const refs: { type: string; id: string; label: string }[] = [];

  const urls: string[] = (Array.isArray(body.urls) ? body.urls : []).map((u: unknown) => String(u)).filter(Boolean).slice(0, 5);
  for (const u of urls) {
    const vid = parseVideoId(u);
    if (!vid) continue;
    const { data: cached } = await d.from("video_hooks").select("full_transcript, title, channel").eq("video_id", vid).single();
    let full = cached?.full_transcript || "";
    let meta = { title: cached?.title || "", channel: cached?.channel || "" };
    if (!full) {
      meta = await oembed(vid);
      const t = await fetchTranscript(vid);
      full = t.full;
      await d.from("video_hooks").upsert({ video_id: vid, title: meta.title, channel: meta.channel, hook_text: t.hook, full_transcript: full }, { onConflict: "video_id" });
    }
    if (!meta.title) meta = await oembed(vid);
    // outlier weight if we know it
    const { data: lib } = await d.from("thumb_library").select("outlier_ratio").eq("video_id", vid).limit(1);
    const w = lib?.[0]?.outlier_ratio ? `${lib[0].outlier_ratio}x its channel's normal` : "performance unknown";
    if (full) {
      sources.push({ label: `"${meta.title}" — ${meta.channel} (${w})`, transcript: full.slice(0, 14_000), weight: w });
      refs.push({ type: "video", id: vid, label: `${meta.title} — ${meta.channel}` });
    }
  }

  const scriptIds: string[] = (Array.isArray(body.scriptIds) ? body.scriptIds : []).map((x: unknown) => String(x)).filter(Boolean).slice(0, 5);
  if (scriptIds.length) {
    const { data: rows } = await d.from("scripts").select("id, title, content").in("id", scriptIds);
    for (const r of rows || []) {
      sources.push({ label: `MY OWN SCRIPT: "${r.title}"`, transcript: String(r.content).slice(0, 14_000), weight: "own" });
      refs.push({ type: "script", id: r.id, label: r.title });
    }
  }

  if (sources.length < 2) return NextResponse.json({ error: "Give at least 2 references (video URLs or your own scripts) — a blueprint is the COMMON structure across them." }, { status: 400 });

  const prompt = [
    (await profileBlock()),
    "You are a script architect. Below are several successful scripts/transcripts. Distill the COMMON STRUCTURE across them — not any one video's outline, but the shared pattern, weighted toward the highest performers.",
    "",
    ...sources.map((s, i) => `SOURCE ${i + 1}: ${s.label}\n${s.transcript}\n`),
    "RULES:",
    "- The blueprint is STRUCTURE only — beat names, purposes, instructions. Never carry over any source's specific words, claims, or facts.",
    "- 6-10 beats, in order. Each beat: a short name, its retention purpose (hook, proof, open loop, payoff, re-hook, pivot, close...), a one-line instruction for writing it, and a [bracketed placeholder] describing exactly what the creator must supply.",
    "- Note where the sources DIVERGE and pick the pattern the stronger performers share.",
    "- Name the blueprint by its shape (e.g. 'Receipts-First Case Study', 'Challenge Documentary'), not by any source's topic.",
    "",
    'Return ONLY raw JSON: {"name":"2-4 word shape name","description":"one sentence: what this structure is good for","beats":[{"name":"...","purpose":"...","instruction":"...","placeholder":"[what the creator supplies]"}]}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 2500);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Distillation returned nothing usable — try again." }, { status: 502 });
    const bp = JSON.parse(m[0]);
    const { data: row, error } = await d.from("blueprints").insert({
      name: String(bp.name || "Untitled blueprint").slice(0, 120),
      description: String(bp.description || "").slice(0, 500),
      beats: (Array.isArray(bp.beats) ? bp.beats : []).slice(0, 12),
      source_refs: refs,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, blueprint: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "distillation failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  const { error } = await db().from("blueprints").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
