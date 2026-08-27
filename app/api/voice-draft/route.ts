// Voice note → structured script draft.
// POST multipart {audio} OR json {transcript}.
// Audio is transcribed with Whisper (Groq free tier, or OpenAI) — both accept
// browser webm directly, no conversion needed. The draft PRESERVES the
// speaker's phrasing; hooks are grounded in the topic's outlier winners.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";
import { scanTopic } from "@/lib/outliers";

export const maxDuration = 300;

async function transcribe(audio: Blob, filename: string): Promise<string> {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (!groq && !openai) throw new Error("Set GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY for voice notes.");
  const url = groq ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
  const model = groq ? "whisper-large-v3-turbo" : "whisper-1";
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", model);
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${groq || openai}` }, body: fd, signal: AbortSignal.timeout(120_000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `STT HTTP ${r.status}`);
  return String(j?.text || "").trim();
}

export async function POST(req: Request) {
  let transcript = "";
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      if (!(audio instanceof Blob)) return NextResponse.json({ error: "Missing audio field." }, { status: 400 });
      transcript = await transcribe(audio, (audio as File).name || "voice-note.webm");
    } else {
      const body = await req.json().catch(() => ({}));
      transcript = String(body.transcript || "").trim();
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "transcription failed" }, { status: 502 });
  }
  if (transcript.length < 40) return NextResponse.json({ error: "Talk through the concept for at least ~15 seconds." }, { status: 400 });

  // Topic → outlier winners → their cached hooks
  let topic = "";
  try {
    topic = (await llm(`This is a voice note describing a YouTube video idea. Reply with ONLY the 2-5 word search phrase for this topic. No quotes.\n\n${transcript.slice(0, 3000)}`, 60))
      .trim().toLowerCase().replace(/^["']|["']$/g, "").slice(0, 80);
  } catch { /* draft still works */ }
  let comps: Awaited<ReturnType<typeof scanTopic>> = [];
  try { if (topic) comps = (await scanTopic(topic)).slice(0, 6); } catch { /* fine */ }
  const { data: hookRows } = comps.length
    ? await db().from("video_hooks").select("video_id, hook_text").in("video_id", comps.map((c) => c.videoId))
    : { data: [] };
  const hooksById = new Map((hookRows || []).map((h) => [h.video_id, h.hook_text]));
  const { data: voiceRows } = await db().from("scripts").select("voice_transcript")
    .neq("voice_transcript", "").order("created_at", { ascending: false }).limit(3);

  const compBlock = comps.map((c, i) => {
    const h = hooksById.get(c.videoId);
    return `${i + 1}. "${c.title}" — ${c.channel}${c.outlierRatio ? ` (${c.outlierRatio}x normal)` : ""}${h ? `\n   THEIR SPOKEN HOOK: ${String(h).slice(0, 400)}` : ""}`;
  }).join("\n");

  const prompt = [
    (await profileBlock()),
    "You are a script editor. Below is a creator's RAW VOICE NOTE — them talking through a video idea. Structure it into a draft. Do NOT rewrite them into generic AI copy.",
    "", "THEIR VOICE NOTE (preserve this voice everywhere):", transcript.slice(0, 12_000),
    (voiceRows || []).length ? "\nMORE OF THEIR REAL VOICE:\n" + (voiceRows || []).map((v) => `- ${String(v.voice_transcript).slice(0, 1200)}`).join("\n") : "",
    topic ? `\nTOPIC: ${topic}` : "",
    compBlock ? `\nWHAT'S WINNING ON THIS TOPIC:\n${compBlock}` : "",
    "",
    "RULES: The draft is built FROM their sentences — reorder, tighten, cut filler, but their phrasing survives. Hooks steal MECHANICS from winners, never words; every claim must come from the voice note. No hype, no 'in this video'. Written to be SPOKEN. The outline is beats to freestyle over.",
    "",
    'Return ONLY raw JSON: {"topic":"2-5 words","title_options":["3 titles, best first"],"hooks":[{"hook":"...","mechanism":"2-4 words","why":"one line"}] (5),"outline":["6-10 beats"],"draft":"markdown draft, 300-800 words, ## sections"}',
  ].filter(Boolean).join("\n");

  try {
    const raw = await llm(prompt, 4000);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Drafting returned nothing usable." }, { status: 502 });
    const d = JSON.parse(m[0]);
    const title = (d.title_options?.[0] || "Untitled voice draft").slice(0, 300);
    const content = [
      d.title_options?.length ? "## Title options\n" + d.title_options.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n") : "",
      d.hooks?.length ? "\n## Hook options\n" + d.hooks.map((h: { mechanism: string; hook: string; why: string }) => `- **${h.mechanism}**: ${h.hook}\n  _${h.why}_`).join("\n") : "",
      d.outline?.length ? "\n## Beats\n" + d.outline.map((b: string) => `- ${b}`).join("\n") : "",
      d.draft ? `\n## Draft\n${d.draft}` : "",
      `\n---\n## Raw voice note\n${transcript}`,
    ].filter(Boolean).join("\n");
    const { data: row, error } = await db().from("scripts").insert({
      title, topic: (d.topic || topic || "").slice(0, 200), hook: (d.hooks?.[0]?.hook || "").slice(0, 2000),
      content: content.slice(0, 200_000), source: "voice-note", voice_transcript: transcript.slice(0, 60_000),
    }).select("id").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, scriptId: row.id, title, topic: d.topic || topic });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "voice draft failed" }, { status: 502 });
  }
}
