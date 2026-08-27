// The likeness bundle: primary avatar (pose/expression) + up to 3 more photos
// OF THE SAME PERSON flagged use_for_likeness. More angles = tighter likeness.
// Photos of different people never mix.
import { db } from "@/lib/supabase";

const MAX_FACE_REFS = 4;

export async function faceBundle(avatarId?: string): Promise<string[]> {
  const { data } = await db()
    .from("avatars")
    .select("id, image, is_default, use_for_likeness, person")
    .order("created_at", { ascending: true });
  const rows = data || [];
  if (!rows.length) return [];
  const primary = (avatarId && rows.find((r) => r.id === avatarId)) || rows.find((r) => r.is_default) || rows[0];
  return [primary, ...rows.filter((r) => r.id !== primary.id && r.use_for_likeness && r.person === primary.person)]
    .slice(0, MAX_FACE_REFS)
    .map((r) => r.image);
}
