import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Supabase client using service role key.
 * This bypasses Row Level Security — use only on the backend.
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log("📦 Supabase client initialized");
