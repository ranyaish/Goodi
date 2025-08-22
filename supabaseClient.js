import { createClient } from "@supabase/supabase-js";
export const sb = (url, serviceKey) =>
  createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "goodi-scraper/1.0" } }
  });
