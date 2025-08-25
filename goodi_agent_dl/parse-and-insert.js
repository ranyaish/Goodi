import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { createClient } from '@supabase/supabase-js';
import { extractCustomerName, toISODateIL } from './utils.js';
import { GOODI } from './agent.config.js';

const {
  DOWNLOAD_DIR = './downloads',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE
} = process.env;

function log(...a){ console.log('[parse]', ...a); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

async function readLatestPath() {
  const p = path.resolve(DOWNLOAD_DIR, 'latest.txt');
  const file = await fs.readFile(p, 'utf8');
  return file.trim();
}

function normalizeHtml(text) {
  // לפעמים מגיע CSV שמכיל HTML — נזהה תגיות
  if (text.trim().startsWith('<')) return text;
  // אם זה טקסט בלי תגיות, אין לנו מה לפרסר לטבלה.
  // (אפשר להרחיב: לחפש דלימיטרים, אבל אצלך זה HTML בתחפושת)
  return text;
}

function extractRowsFromHtml(html) {
  const root = parse(html);
  const tables = root.querySelectorAll('table');
  if (!tables.length) return [];
  // ניקח את הטבלה הכי “גדולה”
  const table = tables.sort((a,b)=> (b.textContent.length)-(a.textContent.length))[0];
  const rows = table.querySelectorAll('tr');
  const data = [];

  rows.slice(1).forEach(tr => {
    const tds = tr.querySelectorAll('td').map(td => td.innerText.trim());
    if (!tds.length) return;
    // ניסוח גמיש:
    // - תא עם “איסוף עצמי, <שם>”
    // - תא עם תאריך (בדרך־כלל בעמודה ראשונה/אחרונה)
    // - סכום – לעתים מופיע “22.00 ₪” או טקסט דומה; אצלך קבוע 22
    const bigCell = tds.find(x => x.includes('איסוף עצמי'));
    const name = extractCustomerName(bigCell || tds.join(' | '));
    // תאריך – ננסה לתפוס משהו שנראה כמו dd/mm/yyyy או dd.mm.yyyy
    const dateCell =
      tds.find(x => /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/.test(x)) ||
      tds.find(x => /\b\d{4}-\d{2}-\d{2}\b/.test(x)) || '';
    const isoDate = toISODateIL(dateCell.match(/\d{1,2}[./]\d{1,2}[./]\d{4}/)?.[0] || dateCell);

    if (name && isoDate) {
      data.push({ name, date: isoDate, amount: GOODI.defaultAmount });
    }
  });

  return data;
}

async function resolveCustomerIds(rows) {
  const names = [...new Set(rows.map(r => r.name))];
  if (!names.length) return {};

  // נביא customers.name,customer_id
  const { data, error } = await sb
    .from('customers')
    .select('name,customer_id')
    .in('name', names);

  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { map[r.name.trim()] = r.customer_id; });
  return map;
}

async function insertCoupons(rows, nameToId) {
  const toInsert = rows
    .map(r => {
      const cid = nameToId[r.name.trim()];
      if (!cid) return null;
      return {
        customer_id: cid,
        date: r.date,
        amount: r.amount,
        redeemed: false,
        redeemed_at: null
      };
    })
    .filter(Boolean);

  if (!toInsert.length) {
    log('no rows to insert (no matched customers)');
    return { inserted: 0 };
  }

  // upsert לפי (customer_id, date) כדי לא להכניס כפולים
  const { data, error, count } = await sb
    .from('coupons')
    .upsert(toInsert, { onConflict: 'customer_id,date', ignoreDuplicates: true })
    .select('*', { count: 'exact' });

  if (error) throw error;
  return { inserted: count || (data?.length ?? 0) };
}

async function logImport(rowsFound, rowsInserted, notes = 'goodi_agent_dl') {
  // מותאם לסכימה שלך: import_logs(id, ran_at, rows_found, rows_inserted, source, ok, notes)
  await sb.from('import_logs').insert({
    ran_at: new Date().toISOString(),
    rows_found: rowsFound,
    rows_inserted: rowsInserted,
    source: 'goodi_agent_dl',
    ok: true,
    notes
  });
}

async function run() {
  const latest = await readLatestPath();
  log('reading', latest);
  const raw = await fs.readFile(latest, 'utf8');
  const html = normalizeHtml(raw);

  const rows = extractRowsFromHtml(html);
  log('parsed rows:', rows.length);

  const nameToId = await resolveCustomerIds(rows);
  const { inserted } = await insertCoupons(rows, nameToId);
  log('inserted:', inserted);

  await logImport(rows.length, inserted);
}

run().catch(async err => {
  console.error('parse error:', err);
  try {
    await logImport(0, 0, String(err));
  } catch {}
  process.exit(1);
});
