// Texto em português: normalização, nomes aproximados, valores e datas ditos do jeito que a gente fala.

import { addDays, addMonths } from './dates.js';

export const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'pra', 'para', 'pro', 'meu', 'minha', 'conta', 'com']);
const tokens = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));

function scoreName(query, name) {
  const q = norm(query);
  const n = norm(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.includes(q) || q.includes(n)) return 85 - Math.min(20, Math.abs(n.length - q.length) / 2);
  const qt = tokens(q);
  const nt = tokens(n);
  if (!qt.length || !nt.length) return 0;
  let hit = 0;
  for (const a of qt) {
    if (nt.some((b) => b === a)) hit += 1;
    else if (nt.some((b) => (a.length >= 4 && b.startsWith(a.slice(0, 4))) || (b.length >= 4 && a.startsWith(b.slice(0, 4))))) hit += 0.7;
  }
  return Math.round((hit / Math.max(qt.length, 1)) * 70);
}

/**
 * Acha o item cujo nome mais parece com `query`.
 * @returns {{match: any|null, candidates: any[], ambiguous: boolean}}
 */
export function matchByName(query, items, getName = (x) => x.name) {
  const scored = items
    .map((it) => ({ it, s: scoreName(query, getName(it)) }))
    .filter((x) => x.s >= 40)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { match: null, candidates: [], ambiguous: false };
  const [top, second] = scored;
  const ambiguous = Boolean(second && top.s < 100 && top.s - second.s < 10 && norm(getName(top.it)) !== norm(getName(second.it)));
  return { match: ambiguous ? null : top.it, candidates: scored.slice(0, 4).map((x) => x.it), ambiguous };
}

const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

function toNumber(raw) {
  let r = raw;
  if (r.includes(',')) r = r.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(r)) r = r.replace(/\./g, '');
  const n = Number(r);
  return Number.isFinite(n) ? n : null;
}

/** "R$ 1.250,50", "1250", "2,5 mil", "mil e duzentos" (só "mil"), "50 conto" → número; null se não achar. */
export function parseMoneyBR(text) {
  const s = String(text ?? '').toLowerCase();
  const re = new RegExp(String.raw`(?:r\$\s*)?(${NUM})(\s*(?:mil|k)\b)?`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 6);
    // ignora "dia 5", "5/12", "12x", "às 10h"
    if (/dia\s*$/.test(before) || /^\s*\//.test(after)) continue;
    if (!m[2] && (/^\s*x\b/.test(after) || /^\s*(h|horas?|dias|vezes|parcelas?|meses|%)(\b|$)/.test(after))) continue;
    if (/\/\s*$/.test(before)) continue;
    let v = toNumber(m[1]);
    if (v == null) continue;
    if (m[2]) v *= 1000;
    return Math.round(v * 100) / 100;
  }
  if (/\bmil\b/.test(s)) return 1000;
  return null;
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** "hoje", "amanhã", "dia 5", "5/12", "05/12/2026", "sexta", "semana que vem" → ISO (ou null). */
export function parseDateBR(text, today) {
  const s = norm(text);
  if (!s) return null;
  if (/\bdepois de amanha\b/.test(s)) return addDays(today, 2);
  if (/\bamanha\b/.test(s)) return addDays(today, 1);
  if (/\bontem\b/.test(s)) return addDays(today, -1);
  if (/\bhoje\b/.test(s)) return today;
  const full = String(text).match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (full) {
    const d = Number(full[1]);
    const mo = Number(full[2]);
    let y = full[3] ? Number(full[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!full[3] && iso < addDays(today, -60)) iso = `${y + 1}${iso.slice(4)}`;
      return clampDay(iso);
    }
  }
  const dia = s.match(/\bdia (\d{1,2})\b/);
  if (dia) {
    const d = Number(dia[1]);
    if (d >= 1 && d <= 31) {
      const nextMonth = /\b(mes que vem|proximo mes)\b/.test(s);
      const base = `${today.slice(0, 8)}01`;
      let iso = clampDay(`${today.slice(0, 8)}${String(d).padStart(2, '0')}`);
      if (nextMonth || iso < today) iso = addMonths(base, 1, d);
      return iso;
    }
  }
  if (/\bsemana que vem\b|\bproxima semana\b/.test(s)) return addDays(today, 7);
  if (/\bmes que vem\b|\bproximo mes\b/.test(s)) return addMonths(today, 1);
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(s)) {
      const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
      const delta = ((i - cur + 7) % 7) || 7;
      return addDays(today, delta);
    }
  }
  return null;
}

function clampDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
