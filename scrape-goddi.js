// scrape-goddi.js
// ===============================
// רץ ב-GitHub Actions: מושך את נתוני Goodi ומכניס ל-Supabase
// עכשיו כולל כתיבת לוג ל- import_logs (כמה רשומות נכתבו ומה הסטטוס)

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const GOODI_USER = process.env.GOODI_USER;
const GOODI_PASS = process.env.GOODI_PASS;
const SB_URL       = process.env.SB_URL;
const SB_SERVICE   = process.env.SB_SERVICE_KEY;

if (!GOODI_USER || !GOODI_PASS || !SB_URL || !SB_SERVICE) {
  console.error("Missing required env vars: GOODI_USER / GOODI_PASS / SB_URL / SB_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SB_URL, SB_SERVICE, {
  auth: { persistSession: false },
});

// helper: הכנסה למאגר עם מניעת כפילות (כמו אצלך: ייחוד לפי date+name)
async function upsertCoupons(rows) {
  let written = 0;

  // נחלק לבאצ'ים כדי להיות עדינים
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { data, error, count } = await supabase
      .from("coupons")
      .upsert(part, { onConflict: "date,name", ignoreDuplicates: true, count: "estimated" });

    if (error) throw error;

    // אם ignoreDuplicates: true, הנתונים שלא הוכנסו לא ייספרו,
    // אז נספור ידנית לפי כמה רשומות חזרו/עברו.
    // רוב הזמן data יהיה null כשcount='estimated', אז נסכם לפי part.
    written += (data?.length ?? 0) || part.length;
  }

  return written;
}

(async () => {
  let insertedCount = 0;

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // === 1) התחברות ל-Goodi (מסך לוגין) ===
    await page.goto("https://goodi.co.il/Restaurant"); // כתובת בסיסית; תתאים ליעד שלך אם יש דף ספציפי
    // מלא שדות כניסה (עדכן סלקטורים אם צריך):
    await page.fill('input[name="userName"]', GOODI_USER);
    await page.fill('input[name="password"]', GOODI_PASS);
    await page.click('input[type="submit"], button[type="submit"]');

    // המתנה לניווט / לדף הדוחות
    await page.waitForLoadState("networkidle");

    // === 2) ניווט לדוח היומי (או לדף שמציג נתונים עדכניים) ===
    // אם יש לשוניות/פילטרים – בחר טווח ימים/דוח "היום".
    // דוגמה כללית; החלף לסלקטורים שלך אם צריך:
    // await page.click('text=דוחות');
    // await page.selectOption('select[name="range"]', 'today');

    // === 3) חילוץ שורות הטבלה ===
    // נתאים לסלקטור של הטבלה בדף.
    // חשוב: החילוץ יחזיר מערך אובייקטים [{date,name,amount}, ...]
    const rows = await page.$$eval("table tr", (trs) => {
      const out = [];
      // מצא כותרות
      let headers = [];
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll("th,td")).map((td) =>
          td.innerText.replace(/\s+/g, " ").trim()
        );
        if (!cells.length) continue;

        if (!headers.length && tr.querySelector("th")) {
          headers = cells.map((h) => h.toLowerCase());
          continue;
        }

        if (headers.length && tr.querySelectorAll("td").length === headers.length) {
          const obj = {};
          headers.forEach((h, i) => (obj[h] = cells[i]));

          // מיפוי לשדות שלנו: "תאריך", "שם עובד", "תשלום"
          const rawDate = obj["תאריך"] || obj["date"];
          const rawName = obj["שם עובד"] || obj["שם לקוח"] || obj["name"];
          const rawAmt  = obj["תשלום"] || obj["amount"];

          if (!rawDate || !rawName || !rawAmt) return;

          // נרמול תאריך ל-YYYY-MM-DD
          // קלט עשוי להיות dd/mm/yyyy
          const m = rawDate.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
          let isoDate = rawDate;
          if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;

          // ניקוי סימני ₪ ופסיקים
          const amt = Number(String(rawAmt).replace(/[^\d.]/g, "") || 0);
          if (!isoDate || !rawName || !amt) return;

          out.push({
            date: isoDate,
            name: rawName,
            amount: amt,
            redeemed: false,
            source_label: "goodi-daily",
          });
        }
      }
      return out;
    });

    await browser.close();

    if (!rows.length) {
      // בלי רשומות – עדיין נכתוב לוג (success עם 0)
      await supabase.from("import_logs").insert([{ records_imported: 0, status: "success" }]);
      console.log("No rows found to import.");
      process.exit(0);
    }

    // === 4) כתיבה ל-Supabase (with ignoreDuplicates) ===
    insertedCount = await upsertCoupons(rows);

    // === 5) כתיבת לוג ל-import_logs ===
    await supabase
      .from("import_logs")
      .insert([{ records_imported: insertedCount, status: "success" }]);

    console.log(`Imported ${insertedCount} rows (deduped).`);
    process.exit(0);
  } catch (err) {
    console.error("Scrape error:", err);

    // לוג כישלון
    try {
      await supabase
        .from("import_logs")
        .insert([{ records_imported: 0, status: "error: " + (err?.message || String(err)) }]);
    } catch (e2) {
      console.error("Failed to write import log:", e2);
    }
    process.exit(1);
  }
})();
