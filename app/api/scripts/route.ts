// Scripts CRUD — the writing surface; also the voice corpus store.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (id) {
    const { data, error } = await db().from("scripts").select("*").eq("id", id).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, script: data });
  }
  const { data, error } = await db().from("scripts")
    .select("id, title, topic, hook, source, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scripts: data || [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "Script needs a title." }, { status: 400 });
  const { data, error } = await db().from("scripts").insert({
    title: title.slice(0, 300),
    topic: String(body.topic || "").slice(0, 200),
    hook: String(body.hook || "").slice(0, 2000),
    content: String(body.content || "").slice(0, 200_000),
    source: String(body.source || "manual").slice(0, 40),
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Pass the script id." }, { status: 400 });
  const patch: Record<string, string> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 300);
  if (typeof body.topic === "string") patch.topic = body.topic.slice(0, 200);
  if (typeof body.hook === "string") patch.hook = body.hook.slice(0, 2000);
  if (typeof body.content === "string") patch.content = body.content.slice(0, 200_000);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const { error } = await db().from("scripts").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  const { error } = await db().from("scripts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
