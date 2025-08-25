export const GOODI = {
  baseUrl: 'https://www.goodi.co.il/Restaurants',
  loginPath: '/Login',      // אם מסך התחברות אחר – נעדכן בהמשך
  reportsPath: '/Home',     // משם עוברים לטאב "דוחות" (לפי ה־UI שלך)
  // סלקטורים – יתכן שתצטרך ללטש: פתח DevTools ובדוק name/id/value
  selectors: {
    reportsTab: 'text=דוחות',
    startDate: 'input[name="StartDate"]',
    endDate: 'input[name="EndDate"]',
    exportType: 'select[name="ExportType"]',
    exportButton: 'input[type="button"][value="הוצא דוח"]',
    // למסכים “קלאסיים” של Goodi לפעמים אין דף לוגין פורמלי — אם יש:
    user: 'input[name="UserName"], input#UserName',
    pass: 'input[name="Password"], input#Password',
    loginBtn: 'button[type="submit"], input[type="submit"]'
  },
  // קבועים עסקיים
  defaultAmount: 22.00
};
