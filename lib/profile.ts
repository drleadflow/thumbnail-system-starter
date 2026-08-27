// Creator profile — Briar Cochran's insight: "slop is usually just a missing
// onboarding." This single row is the context layer injected into EVERY AI
// prompt: who you are, who you serve, what you talk about, what you never do.
import { db } from "@/lib/supabase";

export interface Profile {
  name: string; one_liner: string; business_model: string; audience: string;
  pillars: string; never_talk_about: string; beliefs: string; subreddits: string; my_channel: string;
}

export async function getProfile(): Promise<Profile | null> {
  const { data } = await db().from("creator_profile").select("*").eq("id", 1).single();
  return data || null;
}

// The prompt block. Empty string when no profile exists — every consumer
// degrades gracefully.
export async function profileBlock(): Promise<string> {
  const p = await getProfile();
  if (!p || (!p.one_liner && !p.pillars && !p.audience)) return "";
  return [
    "WHO THE CREATOR IS (calibrate everything to this — it is the difference between their content and generic slop):",
    p.name ? `- Name: ${p.name}` : "",
    p.one_liner ? `- What they do: ${p.one_liner}` : "",
    p.business_model ? `- Business model: ${p.business_model}` : "",
    p.audience ? `- Audience: ${p.audience}` : "",
    p.pillars ? `- Content pillars: ${p.pillars}` : "",
    p.beliefs ? `- Their point of view / beliefs: ${p.beliefs}` : "",
    p.never_talk_about ? `- NEVER suggest or drift into: ${p.never_talk_about} (hard rule — ideas or angles touching these are rejected)` : "",
  ].filter(Boolean).join("\n");
}
