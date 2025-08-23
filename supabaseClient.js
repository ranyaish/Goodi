<!-- קובץ: supabaseClient.js -->
<script>
/** ← ערכים שלך */
const SB_URL = 'https://ylqpxwgchwalcblfipsu.supabase.co';
const SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscXB4d2djaHdhbGNibGZpcHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4MTk3MzQsImV4cCI6MjA3MTM5NTczNH0.bHNNmDlvUj-K1KFYZ1eNSKdzB_EpLmf2KiRhYTrWVPM';

const UMD = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

/** טוען את ספריית ה-UMD אם צריך */
function loadSupabaseUmd() {
  return new Promise((res, rej) => {
    if (window.supabase && typeof window.supabase.createClient === 'function') return res();
    const s = document.createElement('script');
    s.src = UMD; s.async = true;
    s.onload = () => (window.supabase && window.supabase.createClient) ? res() : rej(new Error('UMD loaded but createClient missing'));
    s.onerror = () => rej(new Error('Failed to load supabase UMD'));
    document.head.appendChild(s);
  });
}

/** יוצר קליינט גלובלי בצורה שתתאים לכל קוד קיים */
async function ensureSupabaseClient() {
  await loadSupabaseUmd();

  // אם כבר קיים קליינט — נשתמש בו
  if (window.supabaseClient && window.supabaseClient.from) return window.supabaseClient;

  const client = window.supabase.createClient(SB_URL, SB_ANON_KEY, {
    auth: { persistSession: true },
    global: { headers: { 'x-client-info': 'goodi/14' } },
  });

  // חשיפות גלובליות נוחות/תואמות
  window.supabaseClient = client;          // שימוש ישיר: supabaseClient.from('…')
  window.getSupabase = () => client;       // פונקציה נוחה לקבלת הקליינט
  // משאיר את window.supabase כ־אובייקט הספרייה (לא מוחק/מחליף)

  return client;
}

/** הבטחה שניתן להמתין לה בכל דף */
window.supabaseReady = (async () => {
  try {
    const c = await ensureSupabaseClient();
    return { ok: true, client: c };
  } catch (e) {
    console.error('Supabase bootstrap error:', e);
    return { ok: false, error: e };
  }
})();
</script>
