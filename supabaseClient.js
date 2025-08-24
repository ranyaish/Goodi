// supabaseClient.js — bootstrap יחיד ל-Supabase בדפדפן

// >>> עדכונים שלך (כבר מילאתי): <<<
const SB_URL = 'https://ylqpxwgchwalcblfipsu.supabase.co';
const SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscXB4d2djaHdhbGNibGZpcHN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4MTk3MzQsImV4cCI6MjA3MTM5NTczNH0.bHNNmDlvUj-K1KFYZ1eNSKdzB_EpLmf2KiRhYTrWVPM';

// UMD של הספרייה
const SUPABASE_UMD = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

function loadUmd() {
  return new Promise((resolve, reject) => {
    if (window.supabase && typeof window.supabase.createClient === 'function') return resolve();
    const s = document.createElement('script');
    s.src = SUPABASE_UMD;
    s.async = true;
    s.onload = () => (window.supabase && window.supabase.createClient) ? resolve() :
      reject(new Error('UMD loaded but createClient missing'));
    s.onerror = () => reject(new Error('Failed to load supabase-js UMD'));
    document.head.appendChild(s);
  });
}

async function bootstrap() {
  await loadUmd();
  // אם כבר יצרנו — אל תיצור שוב
  if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
    return window.supabaseClient;
  }
  const client = window.supabase.createClient(SB_URL, SB_ANON_KEY, {
    auth: { persistSession: true },
    global: { headers: { 'x-client-info': 'goodi-app/restore' } },
  });
  // שמים ידית נוחה
  window.supabaseClient = client;
  // לשימוש קל בקוד: window.supabase.client
  window.supabase.client = client;
  return client;
}

// הבטחה גלובלית שניתן לחכות לה בכל עמוד
window.supabaseReady = (async () => {
  try {
    const c = await bootstrap();
    return { ok: true, client: c };
  } catch (e) {
    console.error('Supabase bootstrap error:', e);
    return { ok: false, error: e };
  }
})();
