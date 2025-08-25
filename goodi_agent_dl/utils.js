export function todayIL() {
  const tz = 'Asia/Jerusalem';
  const d = new Date();
  const parts = new Intl.DateTimeFormat('he-IL', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const g = t => parts.find(p => p.type === t)?.value ?? '';
  // HTML inputs בדרך כלל אוהבים yyyy-mm-dd
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function toISODateIL(dateStr) {
  // מקבל "dd/mm/yyyy" או "yyyy-mm-dd" ומנרמל ל yyyy-mm-dd
  if (!dateStr) return null;
  if (dateStr.includes('-')) return dateStr;
  const [d, m, y] = dateStr.split(/[./]/);
  if (!y || !m || !d) return null;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

// חילוץ שם הלקוח מטקסט תא שמכיל “איסוף עצמי” או נוסחים קרובים
export function extractCustomerName(cellText) {
  // דוגמאות שראינו:
  // "איסוף עצמי, זוהר דינה"
  // "איסוף עצמי, יגיע"
  // מנסים לתפוס מה שבא אחרי הפסיק הראשון
  if (!cellText) return null;
  const idx = cellText.indexOf('איסוף עצמי');
  if (idx === -1) return null;
  const after = cellText.slice(idx + 'איסוף עצמי'.length);
  // אחרי הביטוי יש לפעמים פסיקים/רווחים/נקודותיים
  const cleaned = after.replace(/^[\s,:-]+/, '').trim();
  // לוקחים עד סוף השורה או עד מפריד נוסף
  const name = cleaned.split(/[|·•\n\r]/)[0].trim();
  return name || null;
}
