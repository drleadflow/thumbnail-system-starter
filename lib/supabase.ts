// Storage: LOCAL SQLITE BY DEFAULT — zero accounts, zero setup, one file at
// ./data/starter.sqlite. If you'd rather use Supabase (e.g. to share data
// across machines), set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// in .env.local and it switches automatically.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { sqliteDb } from "@/lib/sqlite";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    if (!client) client = createClient(url, key, { auth: { persistSession: false } });
    return client;
  }
  // The shim implements the exact query surface this app uses — presenting it
  // as SupabaseClient keeps every call site type-checking identically.
  return sqliteDb() as unknown as SupabaseClient;
}
