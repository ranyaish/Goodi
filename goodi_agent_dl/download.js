import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { GOODI } from './agent.config.js';
import { todayIL } from './utils.js';

const {
  GOODI_USER,
  GOODI_PASS,
  DOWNLOAD_DIR = './downloads'
} = process.env;

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function log(...a){ console.log('[download]', ...a); }

async function run() {
  const dlAbs = path.resolve(DOWNLOAD_DIR);
  await ensureDir(dlAbs);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    acceptDownloads: true,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem'
  });
  const page = await ctx.newPage();

  const goto = async url => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  try {
    log('open', GOODI.baseUrl);
    await goto(GOODI.baseUrl);

    // אם יש דף לוגין – ננסה לזהות ולמלא
    if (await page.$(GOODI.selectors.user)) {
      log('login form detected');
      await page.fill(GOODI.selectors.user, GOODI_USER || '');
      await page.fill(GOODI.selectors.pass, GOODI_PASS || '');
      const btn = await page.$(GOODI.selectors.loginBtn);
      if (btn) await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        btn.click()
      ]);
    }

    // לטאב "דוחות"
    if (await page.$(GOODI.selectors.reportsTab)) {
      log('go to reports tab');
      await Promise.all([
        page.waitForLoadState('networkidle'),
        page.click(GOODI.selectors.reportsTab)
      ]);
    }

    // מילוי טווח תאריכים: היום ← היום
    const today = todayIL();
    log('dates', today, '→', today);

    await page.fill(GOODI.selectors.startDate, today);
    await page.fill(GOODI.selectors.endDate, today);

    // בחירת "אקסל" (או "מפורט" אם כך תרצה)
    await page.selectOption(GOODI.selectors.exportType, { label: 'אקסל' }).catch(()=>{});

    // הוצא דוח → הורדה
    log('export…');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click(GOODI.selectors.exportButton)
    ]);

    const suggested = await download.suggestedFilename();
    // לפעמים גודי נותן .csv עם HTML – לא אכפת לנו, נשמור כמו שהוא
    const stamp = new Date().toISOString().replace(/[:.]/g,'');
    const fname = suggested || `goodi-${stamp}.csv`;
    const saveAs = path.join(dlAbs, fname);
    await download.saveAs(saveAs);
    log('saved', saveAs);

    // כתובת לקובץ נשמרת לשלב הבא
    await fs.writeFile(path.join(dlAbs, 'latest.txt'), saveAs, 'utf8');
    log('wrote latest.txt');

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('download error:', err);
  process.exit(1);
});
