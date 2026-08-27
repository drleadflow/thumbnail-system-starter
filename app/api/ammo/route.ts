// "More ammo" — Briar's step 8: you picked the idea you're about to film;
// get 2-5 simple talking points to riff on. POST { ideaId } or { title, angle }.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { llm } from "@/lib/imageGen";
import { profileBlock } from "@/lib/profile";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let title = String(body.title || "").trim();
  let angle = String(body.angle || "").trim();
  if (body.ideaId) {
    const { data } = await db().from("ideas").select("title, angle, why_you").eq("id", String(body.ideaId)).single();
    if (data) { title = data.title; angle = [data.angle, data.why_you].filter(Boolean).join(" — "); }
  }
  if (!title) return NextResponse.json({ error: "Pass an idea." }, { status: 400 });
  const prompt = [
    await profileBlock(),
    "",
    `The creator is about to film this video RIGHT NOW: "${title}"${angle ? ` (angle: ${angle})` : ""}.`,
    "Give them 3-5 simple talking points to riff on — ammo, not a script. Each one line, concrete, in plain spoken language. No hooks, no intros, no structure advice — just the meat they can expand on camera.",
    "HARD RULE — never invent the creator's facts: no made-up prices, revenue, results, client stories, or timelines stated as if real. Instead, point them AT their own material: 'share what the setup actually cost you, line by line' not '$47 in API calls'. A talking point either (a) directs them to a specific real thing they'd know, (b) gives a genuinely useful framework/contrast to explain, or (c) raises the question their audience is asking. If a point needs a number, write it as [your real number] placeholder.",
    'Return ONLY a raw JSON array of strings.',
  ].filter(Boolean).join("\n");
  try {
    const raw = await llm(prompt, 700);
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "No ammo came back — try again." }, { status: 502 });
    const points = (JSON.parse(m[0]) as unknown[]).map((x) => String(x).slice(0, 300)).filter(Boolean).slice(0, 5);
    return NextResponse.json({ ok: true, points });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ammo failed" }, { status: 502 });
  }
}
