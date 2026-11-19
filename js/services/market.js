// Cotações ao vivo direto do navegador (APIs públicas com CORS).
// Só sai do aparelho o pedido de cotação — nenhum dado financeiro do usuário.
// Cada indicador tem várias fontes; a primeira que responder com valor plausível vence.

const TIMEOUT_MS = 7000;

export const BTC_SOURCES = [
  {
    name: 'AwesomeAPI',
    url: 'https://economia.awesomeapi.com.br/json/last/BTC-BRL',
    parse: (j) => Number(j?.BTCBRL?.bid),
  },
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl',
    parse: (j) => Number(j?.bitcoin?.brl),
  },
  {
    name: 'Binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCBRL',
    parse: (j) => Number(j?.price),
  },
  {
    name: 'Mercado Bitcoin',
    url: 'https://api.mercadobitcoin.net/api/v4/tickers?symbols=BTC-BRL',
    parse: (j) => Number(Array.isArray(j) ? j[0]?.last : NaN),
  },
];

export const CDI_SOURCES = [
  {
    name: 'BrasilAPI',
    url: 'https://brasilapi.com.br/api/taxas/v1/cdi',
    parse: (j) => Number(j?.valor),
  },
  {
    name: 'Banco Central (SGS 4389)',
    url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json',
    parse: (j) => Number(String(Array.isArray(j) ? j[0]?.valor : '').replace(',', '.')),
  },
  {
    name: 'Banco Central (SGS 12)',
    url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json',
    // taxa diária % → anual base 252
    parse: (j) => {
      const d = Number(String(Array.isArray(j) ? j[0]?.valor : '').replace(',', '.'));
      return Number.isFinite(d) ? (Math.pow(1 + d / 100, 252) - 1) * 100 : NaN;
    },
  },
];

export const RANGES = {
  btc: [10_000, 50_000_000],
  cdi: [1, 60],
};

export function plausible(value, [lo, hi]) {
  return Number.isFinite(value) && value >= lo && value <= hi;
}

async function fetchJSON(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Tenta as fontes em ordem; devolve { value, source, at } ou lança erro. */
export async function fetchFirst(sources, range) {
  const errors = [];
  for (const src of sources) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const json = await fetchJSON(src.url, ctrl.signal);
      const value = src.parse(json);
      if (plausible(value, range)) return { value, source: src.name, at: new Date().toISOString() };
      errors.push(`${src.name}: valor fora do esperado`);
    } catch (err) {
      errors.push(`${src.name}: ${err.name === 'AbortError' ? 'tempo esgotado' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(errors.join(' · '));
}

export const fetchBTC = () => fetchFirst(BTC_SOURCES, RANGES.btc);
export const fetchCDI = () => fetchFirst(CDI_SOURCES, RANGES.cdi);

/**
 * Atualiza o cache de mercado quando estiver velho.
 * @param {object} cache { btc: {value, source, at}, cdi: {...} }
 * @returns {Promise<{cache: object, changed: boolean, errors: string[]}>}
 */
export async function refreshMarket(cache = {}, { force = false, btcMaxAgeMin = 5, cdiMaxAgeMin = 720 } = {}) {
  const next = { ...cache };
  const errors = [];
  let changed = false;
  const old = (entry, maxMin) => !entry?.at || (Date.now() - Date.parse(entry.at)) / 60000 > maxMin;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { cache: next, changed, errors: ['offline'] };
  const jobs = [];
  if (force || old(cache.btc, btcMaxAgeMin)) {
    jobs.push(fetchBTC().then((r) => { next.btc = r; changed = true; }).catch((e) => errors.push(`BTC — ${e.message}`)));
  }
  if (force || old(cache.cdi, cdiMaxAgeMin)) {
    jobs.push(fetchCDI().then((r) => { next.cdi = r; changed = true; }).catch((e) => errors.push(`CDI — ${e.message}`)));
  }
  await Promise.all(jobs);
  return { cache: next, changed, errors };
}
