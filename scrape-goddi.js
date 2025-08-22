import "dotenv/config";
import { chromium } from "playwright";
import { sb } from "./supabaseClient.js";

const {
  GOODI_USER,
  GOODI_PASS,
  SB_URL,
  SB_SERVICE_KEY
} = process.env;

const LOGIN_URL = "https://goodi.co.il/Restaurant";
const REPORT_TAB_SELECTOR = 'text=דוחות';
const DATE_FROM_SELECTOR  = 'input[placeholder="מתאריך"]';
const DATE_TO_SELECTOR    = 'input[placeholder="עד תאריך"]';
const RUN_REPORT_SELECTOR = 'button:has-text("דוח"), input[type=button][value*="דוח"]';

const COL_DATE  = "תאריך";
const COL_NAME  = "שם עובד";
const COL_TOTAL = "תשלום";

const todayISO = () => new Date().toISOString().slice(0,10);
const toISO = (s) => {
  const t = String(s).trim().replaceAll('.', '/');
  const p = t.split('/');
  if (p.length === 3) {
    const [dd, mm, yyyy] = p;
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  return s;
};
const parseAmount = (s) => Number(String(s).replace(/[^\d.]/g, "")) || 0;

(async () => {
  const supabase = sb(SB_URL, SB_SERVICE_KEY);
  let rowsFound = 0, rowsInserted = 0, ok = true, notes = "";

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    if (!GOODI_USER || !GOODI_PASS) throw new Error("חסרים GOODI_USER/GOODI_PASS");
    if (!SB_URL || !SB_SERVICE_KEY) throw new Error("חסרים SB_URL/SB_SERVICE_KEY");

    // login
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="username"], input[name="user"], input[type="text"]', GOODI_USER).catch(()=>{});
    await page.fill('input[name="password"], input[type="password"]', GOODI_PASS).catch(()=>{});
    await page.click('text=כניסה, input[type=submit], button[type=submit]').catch(()=>{});
    await page.waitForLoadState("domcontentloaded");

    // reports tab (אם זמין), קביעת תאריכים של היום
    await page.click(REPORT_TAB_SELECTOR, { timeout: 5000 }).catch(()=>{});
    const today = todayISO();
    await page.fill(DATE_FROM_SELECTOR, today).catch(()=>{});
    await page.fill(DATE_TO_SELECTOR,   today).catch(()=>{});
    await page.click(RUN_REPORT_SELECTOR, { timeout: 5000 }).catch(()=>{});

    // טבלה
    const table = await page.locator("table").first();
    await table.waitFor({ state: "visible", timeout: 8000 }).catch(()=>{});

    // כותרות
    const headers = await table.locator('thead tr th, tr:first-child th, tr:first-child td').allInnerTexts();
    const clean = (x) => String(x).replace(/\s+/g," ").trim();
    const cols = headers.map(clean);
    const iDate  = cols.findIndex(c => c.includes(COL_DATE));
    const iName  = cols.findIndex(c => c.includes(COL_NAME));
    const iTotal = cols.findIndex(c => c.includes(COL_TOTAL));
    if (iDate < 0 || iName < 0 || iTotal < 0) throw new Error("עמודות תאריך/שם עובד/תשלום לא נמצאו");

    // שורות
    const trs = await table.locator("tbody tr").all();
    const records = [];
    for (const tr of trs) {
      const tds = (await tr.locator("td").allInnerTexts()).map(clean);
      if (!tds.length) continue;
      const date = toISO(tds[iDate] || "");
      const name = tds[iName] || "";
      const amount = parseAmount(tds[iTotal] || "0");
      if (date && name && amount) records.push({ date, name, amount });
    }
    rowsFound = records.length;

    // כתיבה ל-DB
    for (const r of records) {
      // לקוח
      const { data: c1 } = await supabase.from("customers")
        .select("customer_id").eq("name", r.name).maybeSingle();

      let customer_id = c1?.customer_id;
      if (!customer_id) {
        const { data: c2, error: e2 } = await supabase
          .from("customers")
          .insert({ name: r.name })
          .select("customer_id")
          .single();
        if (e2) throw e2;
        customer_id = c2.customer_id;
      }

      // שובר – לא לעדכן אם קיים (מניעת כפילות)
      const { error: e3 } = await supabase.from("coupons")
        .insert({ customer_id, date: r.date, amount: r.amount, redeemed: false })
        .onConflict("customer_id, date").ignore();

      if (!e3) rowsInserted++;
      else if (!/duplicate key/i.test(String(e3.message))) throw e3;
    }

    notes = "finished normally";
    console.log(`OK. found=${rowsFound}, inserted=${rowsInserted}`);
  } catch (err) {
    ok = false;
    notes = String(err?.message || err);
    console.error("ERROR:", notes);
  } finally {
    // לוג לטבלה
    await sb(SB_URL, SB_SERVICE_KEY).from("import_logs").insert([{
      rows_found: rowsFound,
      rows_inserted: rowsInserted,
      ok,
      notes
    }]);
    await browser.close();
    process.exit(ok ? 0 : 1);
  }
})();
