// שרץ ע"י: npm run scrape
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { parse } from "node:path";

// ====== קלטים מתוך Secrets ======
const GOODI_USER = process.env.GOODI_USER;
const GOODI_PASS = process.env.GOODI_PASS;
const SB_URL = process.env.SB_URL;
const SB_SERVICE_KEY = process.env.SB_SERVICE_KEY;

// כתובת ברירת מחדל של המערכת (אם תרצה סביבה אחרת, תוכל לשים GOODI_URL ב־secrets)
const GOODI_URL = process.env.GOODI_URL || "https://goodi.co.il/Restaurant/";

// בדיקות בסיסיות
function req(name, val) {
  if (!val) throw new Error(`Missing required env: ${name}`);
}
req("GOODI_USER", GOODI_USER);
req("GOODI_PASS", GOODI_PASS);
req("SB_URL", SB_URL);
req("SB_SERVICE_KEY", SB_SERVICE_KEY);

// חיבור ל־Supabase עם service key (עוקף RLS)
const supabase = createClient(SB_URL, SB_SERVICE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * נסיון לזהות טבלת דוח בעמוד – עם כותרות: תאריך | שם עובד | תשלום
 * מחזיר רשימה סטנדרטית: [{date:'dd/mm/yyyy', worker:'שם', amount: 22}, ...]
 */
async function extractDailyTable(page) {
  // חיפוש כל הטבלאות בעמוד ובדיקה של שורת כותרת
  const tables = await page.$$("table");
  for (const t of tables) {
    const headers = await t.$$eval("tr:first-child th, tr:first-child td", (ths) =>
      ths.map((el) => el.innerText.trim())
    );

    // נדרש למצוא שלוש כותרות (או מאוד דומות) – אפשר טולרנטיות קלה
    const h = headers.join("|");
    const looksLike =
      /תאריך/.test(h) && /שם\s*עובד/.test(h) && /תשלום/.test(h);

    if (!looksLike) continue;

    // שליפת כל השורות אחרי הכותרת
    const rows = await t.$$eval("tr:not(:first-child)", (trs) =>
      trs
        .map((tr) =>
          Array.from(tr.children).map((td) => td.innerText.trim())
        )
        .filter((cols) => cols.length >= 3)
    );

    // ניסיון לאתר את האינדקסים לפי שמות העמודות
    const dateIdx = headers.findIndex((x) => /תאריך/.test(x));
    const workerIdx = headers.findIndex((x) => /שם\s*עובד/.test(x));
    const payIdx = headers.findIndex((x) => /תשלום/.test(x));

    const items = rows.map((cols) => {
      const rawDate = (cols[dateIdx] || "").trim();
      const worker = (cols[workerIdx] || "").trim();
      const payRaw = (cols[payIdx] || "").replace(/[^\d.,-]/g, "").replace(",", ".");
      const amount = Number(payRaw) || 0;

      // ננקה תאריך לפורמט dd/mm/yyyy אם מופיע בפורמט אחר (כמו dd.mm.yyyy)
      let date = rawDate.replace(/\./g, "/");
      // אם מגיע כ־yyyy-mm-dd – נהפוך
      const m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) date = `${m[2]}/${m[3]}/${m[1]}`;

      return { date, worker, amount };
    });

    return items.filter((x) => x.worker && x.amount > 0 && x.date);
  }

  return []; // לא נמצאה טבלה מתאימה
}

/**
 * שמירה ל־DB:
 * 1) יצירת לקוחות אם חסרים
 * 2) הכנסת קופונים עם onConflict(customer_id,date) DO NOTHING
 */
async function saveToDb(items) {
  if (!items.length) return { createdCustomers: 0, insertedCoupons: 0 };

  // 1) שליפת כל השמות הייחודיים
  const names = [...new Set(items.map((i) => i.worker))];

  // לקוחות קיימים
  const { data: existing, error: exErr } = await supabase
    .from("customers")
    .select("customer_id,name")
    .in("name", names);

  if (exErr) throw exErr;

  const existingMap = new Map((existing || []).map((c) => [c.name, c.customer_id]));

  // ליצור חסרים
  const toCreate = names.filter((n) => !existingMap.has(n)).map((name) => ({ name }));
  if (toCreate.length) {
    const { data: created, error: cErr } = await supabase
      .from("customers")
      .insert(toCreate)
      .select("customer_id,name");
    if (cErr) throw cErr;
    for (const c of created) existingMap.set(c.name, c.customer_id);
  }

  // 2) הכנת קופונים
  const coupons = items.map((i) => ({
    customer_id: existingMap.get(i.worker),
    date: i.date,            // dd/mm/yyyy – בעמודת date שלך זה ok (סוג DATE), Supabase יפרש לפי לוקאל? אם תרצה, אפשר להפוך ל־yyyy-mm-dd.
    amount: i.amount,
    redeemed: false,
    source_label: "auto:goodi",
  }));

  // מומלץ להמיר תאריכים ל־yyyy-mm-dd כדי להיות 100% בטוח:
  const norm = (s) => {
    // dd/mm/yyyy -> yyyy-mm-dd
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
  };
  for (const c of coupons) c.date = norm(c.date);

  // 3) הכנסת קופונים – בלי דריסה: ignoreDuplicates עם onConflict
  const { data: ins, error: insErr } = await supabase
    .from("coupons")
    .upsert(coupons, {
      onConflict: "customer_id,date",
      ignoreDuplicates: true,
    })
    .select("id");

  if (insErr) throw insErr;

  return {
    createdCustomers: toCreate.length,
    insertedCoupons: ins ? ins.length : 0,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("▶️ Opening Goodi…", GOODI_URL);
    await page.goto(GOODI_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // === מסך התחברות ===
    // סמנים אופייניים לפי הצילומים שנתת – אם שונים, נעדכן בהמשך:
    const userSel = 'input[name="username"], input[type="text"]';
    const passSel = 'input[name="password"], input[type="password"]';
    const loginBtnSel = 'input[type="submit"], button[type="submit"], input[value="כניסה"], button:has-text("כניסה")';

    await page.fill(userSel, GOODI_USER);
    await page.fill(passSel, GOODI_PASS);
    await page.click(loginBtnSel);

    // המתנה לנווט למסך הראשי
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    await sleep(1500);

    // אם צריך לעבור ללשונית "דוחות" – ננסה לאתר כפתור כזה:
    const reportsTab = await page.locator('text=דוחות').first();
    if (await reportsTab.count()) {
      await reportsTab.click();
      await page.waitForLoadState("networkidle");
      await sleep(1000);
    }

    // חילוץ טבלה (אם היום אין תנועות – יוחזר ריק וזה תקין)
    const items = await extractDailyTable(page);
    console.log(`📄 found ${items.length} rows from page`);

    // שמירה ל־DB
    const res = await saveToDb(items);
    console.log(`✅ DB done: createdCustomers=${res.createdCustomers}, insertedCoupons=${res.insertedCoupons}`);

  } catch (err) {
    console.error("❌ SCRAPE ERROR:", err.message || err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
