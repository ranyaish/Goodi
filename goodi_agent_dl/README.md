# goodi_agent_dl

סוכן עצמאי שמוריד דוח יומי מגודי, מפרק אותו, ומעדכן את `coupons` בסופבייס.

## התקנה מקומית
```bash
cd goodi_agent_dl
cp .env.example .env  # מלא פרטים
npm ci
npm run run           # ינסה להוריד דוח של היום ולהכניס
