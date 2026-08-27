// POST { images?: dataURL[], instructions, count, vary, useFace, avatarId? }
// → 1-4 thumbnail versions in parallel, saved to history.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { generateImage } from "@/lib/imageGen";
import { faceBundle } from "@/lib/avatars";

export const maxDuration = 300;

const EXPRESSIONS = ["shocked, wide eyes", "big excited grin", "confident smirk, one eyebrow up", "intense serious stare, leaning in"];
const VARIATIONS = [
  "",
  " For THIS version: dark background with bright contrasting text.",
  " For THIS version: a bold coloured background and a noticeably different layout.",
  " For THIS version: clean and minimal, fresh colour scheme, different composition.",
];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const instructions = String(body.instructions || "").trim();
  const count = Math.min(4, Math.max(1, Number(body.count) || 3));
  const vary = body.vary !== false;
  const useFace = body.useFace === true;
  const refs: string[] = (Array.isArray(body.images) ? body.images : []).filter((x: unknown) => typeof x === "string" && String(x).startsWith("data:image")).slice(0, 6);
  if (!instructions && !refs.length) return NextResponse.json({ error: "Add a reference image or some instructions." }, { status: 400 });

  let faces: string[] = [];
  if (useFace) {
    faces = await faceBundle(body.avatarId ? String(body.avatarId) : undefined);
    if (!faces.length) return NextResponse.json({ error: "No avatar yet — add one in the Avatars section first." }, { status: 424 });
  }

  const SAFE = " Compose as a 16:9 YouTube thumbnail with breathing room inside every edge — nothing touches or runs off an edge. Render ONE single thumbnail, not a grid or collage.";
  const faceLine = (i: number) => {
    const n = faces.length;
    if (!n) return "";
    const which = n === 1 ? "The FINAL reference image is a real photo" : `The FINAL ${n} reference images are all real photos`;
    return ` ${which} of the SUBJECT — the SAME real person${n > 1 ? " from different angles; study all of them to lock their exact facial structure" : ""}. Preserve their facial likeness faithfully; replace any other person in the earlier reference(s) with them. Expression this version: ${EXPRESSIONS[i % EXPRESSIONS.length]}.`;
  };

  const t0 = Date.now();
  const jobs = Array.from({ length: count }, (_, i) =>
    generateImage({
      prompt: (instructions || "Make a cleaner, higher-quality version of this thumbnail.") + SAFE + (vary && count > 1 ? VARIATIONS[i % VARIATIONS.length] : "") + faceLine(i),
      refs: [...refs, ...faces],
    }),
  );
  const settled = await Promise.allSettled(jobs);
  const images = settled.filter((s): s is PromiseFulfilledResult<string> => s.status === "fulfilled").map((s) => s.value);
  if (!images.length) {
    const err = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    return NextResponse.json({ error: String((err?.reason as Error)?.message || "no images produced").slice(0, 400) }, { status: 502 });
  }
  const { data: session } = await db().from("thumb_sessions")
    .insert({ instructions, ref_images: refs, outputs: images, took_ms: Date.now() - t0 })
    .select("id").single();
  return NextResponse.json({ ok: true, images, sessionId: session?.id || null });
}
