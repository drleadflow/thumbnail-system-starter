// Creator profile CRUD — the onboarding that kills slop.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getProfile } from "@/lib/profile";

export async function GET() {
  return NextResponse.json({ ok: true, profile: await getProfile() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const fields = ["name", "one_liner", "business_model", "audience", "pillars", "never_talk_about", "beliefs", "subreddits"] as const;
  const row: Record<string, string> = { id: "1" as unknown as string };
  for (const f of fields) row[f] = String(body[f] ?? "").slice(0, 3000);
  const { error } = await db().from("creator_profile").upsert({ ...row, id: 1, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
