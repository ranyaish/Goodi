const SB_URL = "https://ylqpxwgchwalcblfipsu.supabase.co";
const SB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscXB4d2djaHdhbGNibGZpcHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4MTk3MzQsImV4cCI6MjA3MTM5NTczNH0.bHNNmDlvUj-K1KFYZ1eNSKdzB_EpLmf2KiRhYTrWVPM"; // המפתח הארוך

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

function ensureSupabaseLib() {
  return new Promise((resolve, reject) => {
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return resolve();
    }
    const s = document.createElement("script");
    s.src = SUPABASE_CDN;
    s.async = true;
    s.onload = () => {
      if (window.supabase && typeof window.supabase.createClient === "function") {
        resolve();
      } else {
        reject(new Error("supabase-js לא עלה"));
      }
    };
    s.onerror = () => reject(new Error("שגיאה בטעינת supabase-js מה-CDN"));
    document.head.appendChild(s);
  });
}

async function bootstrapSupabase() {
  await ensureSupabaseLib();
  const client = window.supabase.createClient(SB_URL, SB_ANON_KEY);
  window.supabase.client = client;
  return client;
}

window.supabaseReady = (async () => {
  try {
    const c = await bootstrapSupabase();
    return { ok: true, client: c };
  } catch (e) {
    return { ok: false, error: e };
  }
})();
