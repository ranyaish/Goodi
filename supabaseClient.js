// supabaseClient.js — self-contained bootstrap for Supabase on GitHub Pages
// 1) UPDATE THESE TWO CONSTANTS:
const SB_URL = 'https://ylqpxwgchwalcblfipsu.supabase.co';
const SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscXB4d2djaHdhbGNibGZpcHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4MTk3MzQsImV4cCI6MjA3MTM5NTczNH0.bHNNmDlvUj-K1KFYZ1eNSKdzB_EpLmf2KiRhYTrWVPM';

// 2) UMD CDN for the browser build of @supabase/supabase-js v2
const SUPABASE_CDN =
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

// Small helper to log nicely without breaking the UI
function sbLog(...args) {
try { console.log('[supabaseClient]', ...args); } catch (_) {}
}

// Load the UMD if needed
function ensureSupabaseLib() {
return new Promise((resolve, reject) => {
if (window.supabase && typeof window.supabase.createClient === 'function') {
return resolve();
}
const s = document.createElement('script');
s.src = SUPABASE_CDN;
s.async = true;
s.onload = () => {
if (window.supabase && typeof window.supabase.createClient === 'function') {
resolve();
} else {
reject(new Error('supabase-js UMD loaded but window.supabase.createClient is missing'));
}
};
s.onerror = () => reject(new Error('Failed to load supabase-js from CDN'));
document.head.appendChild(s);
});
}

// Create client and expose globals
async function bootstrapSupabase() {
await ensureSupabaseLib();
const client = window.supabase.createClient(SB_URL, SB_ANON_KEY, {
auth: { persistSession: true },
global: { headers: { 'x-client-info': 'goodi-app/1.0' } },
});

// Expose for app code (KEEPING compatibility with your current usage)
// We DO NOT overwrite window.supabase (the library object).
// Instead, we attach commonly used fields to it.
window.supabase.client = client;
window.supabase.SB_URL = SB_URL;
window.supabase.SB_ANON_KEY = SB_ANON_KEY;

// Extra aliases if you prefer:
window.supabaseClient = client;         // direct handle
window.SB = { client, SB_URL, SB_ANON_KEY }; // tidy namespace

sbLog('Client ready for', SB_URL);
return client;
}

// A promise you can await if needed elsewhere
window.supabaseReady = (async () => {
try {
const c = await bootstrapSupabase();
return { ok: true, client: c };
} catch (err) {
console.error('Supabase bootstrap error:', err);
return { ok: false, error: err };
}
})();

