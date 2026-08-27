// Avatar library — photos per person; likeness flags; one default.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db().from("avatars")
    .select("id, name, person, image, is_default, use_for_likeness")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, avatars: data || [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 80);
  const image = String(body.image || "");
  if (!name) return NextResponse.json({ error: "Give the avatar a name." }, { status: 400 });
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) return NextResponse.json({ error: "Image must be a PNG/JPEG/WebP data URL." }, { status: 400 });
  if (image.length > 4_000_000) return NextResponse.json({ error: "Keep avatars under ~3MB." }, { status: 413 });
  const { count } = await db().from("avatars").select("id", { count: "exact", head: true });
  const { data, error } = await db().from("avatars")
    .insert({ name, image, person: String(body.person || "me").trim().toLowerCase().slice(0, 60) || "me", is_default: (count || 0) === 0 })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Pass the avatar id." }, { status: 400 });
  const d = db();
  if (body.makeDefault === true) {
    await d.from("avatars").update({ is_default: false }).eq("is_default", true);
    const { error } = await d.from("avatars").update({ is_default: true }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof body.likeness === "boolean") {
    const { error } = await d.from("avatars").update({ use_for_likeness: body.likeness }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (typeof body.person === "string" && body.person.trim()) {
    const { error } = await d.from("avatars").update({ person: body.person.trim().toLowerCase().slice(0, 60) }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Pass makeDefault, likeness, or person." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  const { error } = await db().from("avatars").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
