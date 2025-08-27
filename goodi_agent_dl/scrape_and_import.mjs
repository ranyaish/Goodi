import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';
import parseAndInsert from './parse_goodi_html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GOODI_URL  = 'https://www.goodi.co.il/Restaurants/Home/';
const USER = process.env.GOODI_USER;
const PASS = process.env.GOODI_PASS;

if (!USER || !PASS) {
  console.error('Missing GOODI_USER / GOODI_PASS env vars');
  process.exit(1);
}

// תאריך היום בפורמט dd/MM/yyyy (כמו בשדות באתר)
function todayStr() {
  const tz = 'Asia/Jerusalem';
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function loginAndDownload() {
  // אמולטור כרום עברי, טיים-זון ישראל, יוזר־אייג'נט "כרום רגיל"
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    ...devices['Desktop Chrome'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    acceptDownloads: true
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // כניסה
  await page.goto(GOODI_URL, { waitUntil: 'domcontentloaded' });

  // אם יש דף לוגין (ייתכן שהאתר זוכר סשן; נטפל בשני המצבים)
  if (await page.locator('input[type="password"]').first().isVisible().catch(()=>false)) {
    // נסה למצוא שדות שם משתמש/סיסמה (השמות באתר משתנים, אז עובדים "גמיש")
    const userInput = page.locator('input[type="text"], input[name*=user], input[name*=User]').first();
    const passInput = page.locator('input[type="password"]').first();
    await userInput.fill(USER);
    await passInput.fill(PASS);
    // כפתור התחברות
    const loginBtn = page.locator('button:has-text("כניסה"), input[type=submit], input[value*="כניסה"]').first();
    await Promise.all([
      page.waitForLoadState('networkidle'),
      loginBtn.click()
    ]);
  }

  // מעבר לטאב/מסך "דוחות"
  // אופציה 1: לחיצה לפי טקסט
  const reportsTab = page.locator('text=דוחות').first();
  if (await reportsTab.isVisible().catch(()=>false)) {
    await reportsTab.click();
  } else {
    // אופציה 2: קישור ישיר לטופס הייצוא (באתר יש form ExportForm)
    await page.goto('https://www.goodi.co.il/Restaurants/Home/', { waitUntil: 'domcontentloaded' });
  }

  // ודא שהטופס של הייצוא קיים
  const startInput = page.locator('input[name="ExportStartDate"]');
  const endInput   = page.locator('input[name="ExportEndDate"]');

  if (!(await startInput.isVisible().catch(()=>false))) {
    // נסיוניות: אם הטאב לא נטען עדיין – חפשי בלשונית "דוחות" או בכפתורי סינון
    await page.waitForSelector('form#ExportForm, input[name="ExportStartDate"]', { timeout: 15000 });
  }

  const today = todayStr();
  await startInput.fill(today);
  await endInput.fill(today);

  // כפתור "ייצא דוח" – באתר הוא בדרך כלל input[type=button] עם value "ייצא דוח"
  const exportBtn = page.locator('input[type="button"][value*="ייצא"], input[value*="דוח"]').first();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click()
  ]);

  // שמירת הקובץ שהורד (יהיה HTML או CSV – בפועל זה HTML עם סיומת csv לעתים)
  const tmpPath = await download.path();
  const outPath = path.join(__dirname, 'report_today.html'); // נכריח HTML
  await fs.copyFile(tmpPath, outPath);

  await context.close();
  return outPath;
}

(async () => {
  try {
    const htmlPath = await loginAndDownload();
    console.log('Downloaded report to:', htmlPath);

    // פירוק והכנסה ל-Supabase
    const inserted = await parseAndInsert(htmlPath);
    console.log(`Finished. Upserted ${inserted} rows.`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();