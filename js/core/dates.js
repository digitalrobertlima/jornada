// Datas como strings ISO locais (YYYY-MM-DD). Toda aritmética usa UTC para
// não sofrer com horário de verão nem com o fuso do aparelho.

const DAY_MS = 86400000;

export function pad(n) {
  return String(n).padStart(2, '0');
}

/** Data local de hoje em ISO (YYYY-MM-DD). */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function isoToUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcToISO(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addDays(iso, n) {
  return utcToISO(isoToUTC(iso) + n * DAY_MS);
}

/** Dias de `a` até `b` (b - a). */
export function diffDays(a, b) {
  return Math.round((isoToUTC(b) - isoToUTC(a)) / DAY_MS);
}

/** Soma meses mantendo o dia, limitado ao último dia do mês. */
export function addMonths(iso, n, keepDay) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = keepDay || d;
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(day, last))}`;
}

export function weekday(iso) {
  return new Date(isoToUTC(iso)).getUTCDay();
}

export function isBusinessDay(iso) {
  const w = weekday(iso);
  return w !== 0 && w !== 6;
}

/** Dias úteis (seg–sex) no intervalo (from, to]. Feriados não são considerados. */
export function businessDaysBetween(from, to) {
  const total = diffDays(from, to);
  if (total <= 0) return 0;
  let count = 0;
  for (let i = 1; i <= total; i++) if (isBusinessDay(addDays(from, i))) count++;
  return count;
}

/** Próxima ocorrência de um dia do mês a partir de hoje (inclusive). */
export function nextDayOfMonth(day, today) {
  const [y, m] = today.split('-').map(Number);
  const thisMonth = addMonths(`${y}-${pad(m)}-01`, 0, day);
  return thisMonth >= today ? thisMonth : addMonths(`${y}-${pad(m)}-01`, 1, day);
}

export function minISO(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
