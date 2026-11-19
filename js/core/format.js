// Formatação pt-BR. Números sempre com tabular-nums no CSS.

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlFmt0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

export function brl(x, { cents = true } = {}) {
  const v = Number(x) || 0;
  return (cents ? brlFmt : brlFmt0).format(v).replace(/ /g, ' ');
}

/** R$ 1,2 mil / R$ 3,4 mi */
export function brlShort(x) {
  const v = Number(x) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl(v, { cents: a < 1000 });
}

export function int(x) {
  return intFmt.format(Math.round(Number(x) || 0));
}

export function decimal(x) {
  return dec2.format(Number(x) || 0);
}

export function pct(x, digits = 1) {
  return `${(Number(x) || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
}

export function sats(x) {
  return `${intFmt.format(Math.floor(Number(x) || 0))} sats`;
}

export function btc(satoshis) {
  return `${((Number(satoshis) || 0) / 1e8).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function dateShort(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function dateBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function dateHuman(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[w]}, ${d} ${MONTHS[m - 1]}`;
}

/** 965 → "16h 05min"; 45 → "45min" */
export function lifeTime(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return `${int(h)}h ${String(m).padStart(2, '0')}min`;
}

export function relDays(days) {
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days < 0) return `há ${-days} dias`;
  return `em ${days} dias`;
}

/** Converte "1.234,56" ou "1234.56" para número. */
export function parseMoney(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}
