export function uid(prefix = 'id') {
  const rnd = (globalThis.crypto && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function clone(x) {
  return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function sum(list, fn = (x) => x) {
  let s = 0;
  for (const item of list) s += Number(fn(item)) || 0;
  return s;
}

export function num(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export function byId(list) {
  const map = new Map();
  for (const item of list) map.set(item.id, item);
  return map;
}

export function round2(x) {
  return Math.round(num(x) * 100) / 100;
}
