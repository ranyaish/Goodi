// scrape-goddi.js
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const GOODI_URL = process.env.GOODI_URL || "https://goodi.co.il/Restaurant/";
const USER = process.env.GOODI_USER;
const PASS = process.env.GOODI_PASS;

const SB_URL = process.env.SB_URL;
const SB_SERVICE_KEY = process.env.SB_SERVICE_KEY;

if (!USER || !PASS || !SB_URL || !SB_SERVICE_KEY) {
  console.error("Missing required env vars. Need GOODI_USER, GOODI_PASS, SB_URL, SB_SERVICE_KEY");
  process.exit(1);
}

// ---------- helpers ----------
const ART_DIR = path.join(process.cwd(), "artifacts");
fs.mkdirSync(ART_DIR, { recursive: true });

async function saveArtifacts(page, label) {
  try {
    await page.screenshot({ path: path.join(ART_DIR, `${label}.png`), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(ART_DIR, `${label}.html`), html, "utf8");
  } catch (e) {
    console.warn("Failed to save artifacts:", e.message);
  }
}

function ddmmyyyy(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear());
  return `${d}/${m}/${y}`;
}

// חיפוש שדה בעמוד או בכל הפריימים
async function findInFrames(page, selectorCandidates, timeout = 45000) {
  const deadline = Date.now() + timeout;
  const frames = () => [page.mainFrame(), ...page.frames()];

  while (Date.now() < deadline) {
    for (const f of frames()) {
      for (const sel of selectorCandidates) {
        const el = await f.$(sel).catch(() => null);
        if (el) return { frame: f, handle: el, selector: sel };
      }
    }
    await page.waitForTimeout(300); // פולינג קצר
  }
  return null;
}

// ---------- main ----------
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  });
  const page = await ctx.newPage();

  try {
    console.log("Navigating to:", GOODI_URL);
    await page.goto(GOODI_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForLoadState("networkidle", { timeout: 90000 });

    // נסה למצוא שדות התחברות בכל הפריימים
    const userSelectors = [
      'input[name="userName"]',
      'input[name="username"]',
      'input[id*="user"]',
      'input[placeholder*="משתמש"]',
      'input[type="text"]'
    ];
    const passSelectors = [
      'input[name="password"]',
      'input[id*="pass"]',
      'input[placeholder*="סיסמא"]',
      'input[type="password"]'
    ];
    const loginBtnSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'button:has-text("כניסה")',
      'input[value*="כניסה"]'
    ];

    // חפש שדה משתמש
    const userField = await findInFrames(page, userSelectors, 60000);
    if (!userField) {
      console.error("Could not locate username field in any frame.");
      await saveArtifacts(page, "no-username-field");
      throw new Error("username field not found");
    }
    const passField = await findInFrames(page, passSelectors, 20000);
    if (!passField) {
      console.error("Could not locate password field in any frame.");
      await saveArtifacts(page, "no-password-field");
      throw new Error("password field not found");
    }

    // מלא פרטים
    console.log("Filling credentials…");
    await userField.handle.fill(USER, { timeout: 30000 });
    await passField.handle.fill(PASS, { timeout: 30000 });

    // כפתור כניסה
    const loginBtn = await findInFrames(page, loginBtnSelectors, 20000);
    if (loginBtn) {
      await loginBtn.handle.click();
    } else {
      // אם אין כפתור — ננסה Enter על הסיסמה
      await passField.handle.press("Enter");
    }

    // המתן לניווט אחרי התחברות (או שינוי URL/פריים)
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: 90000 }),
      page.waitForURL(/Restaurant|Reports|Orders|Dashboard/i, { timeout: 90000 }).catch(() => {})
    ]);

    // נקודת הוכחה – שמור צילום מסך אחרי לוגין
    await saveArtifacts(page, "after-login");

    // === דוגמה לקריאת נתוני היום מהדף ===
    // אם יש טבלה בדוח היומי — משוך אותה.
    // כדי שלא ננחש סלקטור ספציפי, ניקח את כל ה־rows מכל הפריימים וננסה לנרמל.
    let rows = [];
    for (const f of [page.mainFrame(), ...page.frames()]) {
      const trs = await f.$$eval("table tr", trs =>
        trs.map(tr => Array.from(tr.cells).map(td => td.innerText.trim()))
      ).catch(() => []);
      if (trs && trs.length) rows.push(...trs);
    }
    console.log("Found rows:", rows.length);

    // סינון גס לכותרות/שורות ריקות
    rows = rows.filter(r => r && r.length >= 3);

    // נסה למפות לעמודות: [תשלום, שם עובד, תאריך]
    // תאריך בפורמט dd/mm/yyyy
    const today = new Date();
    const todayStr1 = ddmmyyyy(today);               // 22/08/2025
    const todayStr2 = ddmmyyyy(new Date(today));     // אותו דבר, לשמירה

    const candidates = [];
    for (const r of rows) {
      const joined = r.join(" ");
      // תשלום – נחפש ₪ או מספר עם נקודה/פסיק
      const amountMatch = joined.match(/₪?\s?(\d+(?:[.,]\d{1,2})?)/);
      const dateMatch = joined.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (amountMatch && dateMatch) {
        // שם עובד: ניקח את הטקסט בין הסכום לתאריך או עמודה אמצעית נפוצה
        let employee = r[1] || r[0];
        const amount = amountMatch[1].replace(",", ".");
        const date = dateMatch[1];

        candidates.push({ date, employee, amount });
      }
    }

    console.log("Parsed rows (first 5):", candidates.slice(0, 5));

    // כאן במקום console.log היינו דוחפים ל-Supabase כמו בקוד הקודם שלך…
    // נשמור artifact JSON כדי לבדוק את הפורמט לפני שמכניסים ל-DB.
    fs.writeFileSync(path.join(ART_DIR, "parsed.json"), JSON.stringify(candidates, null, 2), "utf8");

    console.log("Scrape finished OK, parsed:", candidates.length);
    process.exit(0);
  } catch (err) {
    console.error("Scrape error:", err?.message || err);
    await saveArtifacts(page, "on-error");
    process.exit(1);
  } finally {
    await ctx.close();
    await browser.close();
  }
})();
