// GET → past generation rounds (newest first).
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db().from("thumb_sessions")
    .select("id, instructions, ref_images, outputs, took_ms, created_at")
    .order("created_at", { ascending: false }).limit(24);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sessions: data || [] });
}
