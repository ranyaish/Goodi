import fs from 'node:fs/promises';
import { load } from 'cheerio';              // ⬅︎ בלי default
import { createClient } from '@supabase/supabase-js';

// מקבלים גם את שמות ה-ENV מה־YAML שלך וגם את השמות המקוריים
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.SB_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SB_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL/SB_URL or SUPABASE_SERVICE_KEY/SB_SERVICE_KEY env vars');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// עוזרים
const cleanAmount = s =>
  Number(String(s || '').replace(/[^\d.,]/g, '').replace(',', '.'));

const toIsoDate = (s) => {
  // "25/08/2025 13:48:32" או "25.08.2025 13:48:32"
  const m = /(\d{2})[./](\d{2})[./](\d{4})/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

async function ensureCustomerByName(name) {
  const { data: found, error: e1 } = await sb
    .from('customers')
    .select('customer_id')
    .eq('name', name)
    .maybeSingle();
  if (e1) throw e1;
  if (found) return found.customer_id;

  const { data: ins, error: e2 } = await sb
    .from('customers')
    .insert({ name })
    .select('customer_id')
    .single();
  if (e2) throw e2;
  return ins.customer_id;
}

export default async function parseAndInsert(htmlPath) {
  const html = await fs.readFile(htmlPath, 'utf8');
  const $ = load(html);                       // ⬅︎ שימוש נכון ב-cheerio

  const rows = $('#ICReports tr');
  if (!rows || rows.length <= 2) {
    console.log('No data rows found in report');
    return 0;
  }

  const dataRows = rows.slice(1, -1); // ללא כותרת וללא סיכום
  const upserts = [];

  dataRows.each((_, tr) => {
    const tds = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
    // צפי: [תאריך, שם עובד, הזמנה, מזומן, תשלום ללא מע"מ, תשלום, סה״כ]
    const [dateTime, employeeName, orderId, _cash, _noVat, payment, total] = tds;

    const amount = cleanAmount(total || payment);
    const date = toIsoDate(dateTime);

    if (!date || !employeeName || !orderId || !amount) return;

    upserts.push({ employeeName, orderId: String(orderId), amount, date });
  });

  if (!upserts.length) return 0;

  // resolve customers sequentially (פחות בקשות = פחות שגיאות)
  const prepared = [];
  for (const r of upserts) {
    const customer_id = await ensureCustomerByName(r.employeeName);
    prepared.push({
      customer_id,
      date: r.date,
      amount: r.amount,
      redeemed: false,
      redeemed_at: null,
      order_id: r.orderId,
      source: 'goodi_html_agent',
    });
  }

  const { error } = await sb
    .from('coupons')
    .upsert(prepared, { onConflict: 'order_id' });

  if (error) throw error;
  return prepared.length;
}
