// Leitor offline de boleto FEBRABAN — 100% no aparelho, zero rede.
//
// Formatos aceitos:
//   47 dígitos  linha digitável de título bancário
//   44 dígitos  código de barras (bancário ou arrecadação — o que a câmera lê)
//   48 dígitos  linha digitável de arrecadação (concessionárias, tributos)
//
// Fator de vencimento: dias desde 07/10/1997. Em 22/02/2025 o fator chegou a
// 9999 e reiniciou em 1000. Cada ciclo novo soma 9000 dias. O ciclo é escolhido
// pela data mais próxima da data de referência (hoje), o que resolve boletos de
// 2025, 2026 e dos próximos ~12 anos sem ambiguidade.

const DAY_MS = 86400000;
const BASE_1997 = Date.UTC(1997, 9, 7);
const CYCLE_DAYS = 9000;

export const BANKS = {
  '001': 'Banco do Brasil', '004': 'Banco do Nordeste', '021': 'Banestes', '033': 'Santander',
  '041': 'Banrisul', '070': 'BRB', '077': 'Banco Inter', '084': 'Uniprime', '085': 'Ailos',
  '104': 'Caixa', '136': 'Unicred', '197': 'Stone', '208': 'BTG Pactual', '212': 'Banco Original',
  '237': 'Bradesco', '260': 'Nubank', '290': 'PagBank', '323': 'Mercado Pago', '336': 'C6 Bank',
  '341': 'Itaú', '380': 'PicPay', '389': 'Mercantil', '403': 'Cora', '422': 'Safra',
  '461': 'Asaas', '536': 'Neon', '637': 'Sofisa', '655': 'Votorantim', '707': 'Daycoval',
  '745': 'Citibank', '748': 'Sicredi', '756': 'Sicoob',
};

export const SEGMENTS = {
  1: 'Prefeituras', 2: 'Saneamento', 3: 'Energia elétrica e gás', 4: 'Telecomunicações',
  5: 'Órgãos governamentais', 6: 'Carnês e assemelhados', 7: 'Multas de trânsito', 9: 'Uso exclusivo do banco',
};

export function onlyDigits(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

/** Módulo 10 (pesos 2,1 da direita para a esquerda; soma dos algarismos). */
export function mod10(num) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = (num.charCodeAt(i) - 48) * weight;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(num) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += (num.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

/** Módulo 11 do DV geral de título bancário: resultados 0, 10 e 11 viram 1. */
export function mod11Bank(num) {
  const r = 11 - (mod11Sum(num) % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

/** Módulo 11 de arrecadação: resto 0 ou 1 → 0; demais → 11 - resto. */
export function mod11Collection(num) {
  const rest = mod11Sum(num) % 11;
  return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

function isoFromUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function utcFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function todayUTC() {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Converte fator de vencimento em data ISO, escolhendo o ciclo mais próximo da referência. */
export function factorToDate(factor, referenceISO) {
  const f = Number(factor);
  if (!Number.isInteger(f) || f < 1000 || f > 9999) return null; // 0000 = sem vencimento
  const ref = referenceISO ? utcFromISO(referenceISO) : todayUTC();
  let best = null;
  let bestDist = Infinity;
  for (let k = 0; k <= 6; k++) {
    const ms = BASE_1997 + (f + k * CYCLE_DAYS) * DAY_MS;
    const dist = Math.abs(ms - ref);
    if (dist < bestDist) {
      bestDist = dist;
      best = ms;
    }
  }
  return isoFromUTC(best);
}

/** Converte data ISO em fator de vencimento (pós-virada de 22/02/2025 incluída). */
export function dateToFactor(iso) {
  let days = Math.round((utcFromISO(iso) - BASE_1997) / DAY_MS);
  if (days < 1000) throw new RangeError('Data anterior ao fator 1000 (03/07/2000).');
  while (days > 9999) days -= CYCLE_DAYS;
  return days;
}

function formatBankLine(line) {
  return `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} `
    + `${line.slice(21, 26)}.${line.slice(26, 32)} ${line[32]} ${line.slice(33)}`;
}

function formatCollectionLine(line) {
  const b = [0, 1, 2, 3].map((i) => line.slice(i * 12, i * 12 + 12));
  return b.map((x) => `${x.slice(0, 11)}-${x[11]}`).join(' ');
}

function bankBarcodeToLine(bc) {
  const f1 = bc.slice(0, 4) + bc.slice(19, 24);
  const f2 = bc.slice(24, 34);
  const f3 = bc.slice(34, 44);
  return f1 + mod10(f1) + f2 + mod10(f2) + f3 + mod10(f3) + bc[4] + bc.slice(5, 19);
}

function collectionModulo(valueType) {
  return valueType === 6 || valueType === 7 ? mod10 : mod11Collection;
}

function collectionBarcodeToLine(bc) {
  const mod = collectionModulo(Number(bc[2]));
  let out = '';
  for (let i = 0; i < 4; i++) {
    const block = bc.slice(i * 11, i * 11 + 11);
    out += block + mod(block);
  }
  return out;
}

function emptyResult(input, digits) {
  return {
    input: String(input ?? ''),
    digits,
    kind: null, // 'bank' | 'collection'
    format: null, // 'line47' | 'barcode44' | 'line48'
    isValid: false,
    errors: [],
    warnings: [],
    bankCode: null,
    bankName: null,
    currency: null,
    dueFactor: null,
    dueDate: null,
    dueDateHint: null,
    amountCents: null,
    amount: null,
    barcode: null,
    line: null,
    lineFormatted: null,
    segment: null,
    segmentName: null,
    valueType: null,
    companyId: null,
  };
}

function fillBank(r, barcode, referenceISO) {
  r.kind = 'bank';
  r.barcode = barcode;
  r.line = bankBarcodeToLine(barcode);
  r.lineFormatted = formatBankLine(r.line);
  r.bankCode = barcode.slice(0, 3);
  r.bankName = BANKS[r.bankCode] || null;
  r.currency = barcode[3];
  r.dueFactor = Number(barcode.slice(5, 9));
  r.dueDate = factorToDate(r.dueFactor, referenceISO);
  r.amountCents = Number(barcode.slice(9, 19));
  r.amount = r.amountCents / 100;
  if (r.currency !== '9') r.warnings.push('Moeda diferente de Real (código 9).');
  if (r.dueFactor === 0) r.warnings.push('Boleto sem data de vencimento (contra-apresentação).');
  const expected = mod11Bank(barcode.slice(0, 4) + barcode.slice(5));
  if (expected !== Number(barcode[4])) {
    r.errors.push(`Dígito verificador geral inválido (esperado ${expected}).`);
  }
}

function findDateHint(free, referenceISO) {
  const ref = referenceISO ? utcFromISO(referenceISO) : todayUTC();
  for (let i = 0; i + 8 <= free.length; i++) {
    const s = free.slice(i, i + 8);
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) continue;
    const ms = Date.UTC(y, m - 1, d);
    const back = new Date(ms);
    if (back.getUTCDate() !== d) continue;
    if (Math.abs(ms - ref) <= 400 * DAY_MS) return isoFromUTC(ms);
  }
  return null;
}

function fillCollection(r, barcode, referenceISO) {
  r.kind = 'collection';
  r.barcode = barcode;
  r.segment = Number(barcode[1]);
  r.segmentName = SEGMENTS[r.segment] || 'Segmento desconhecido';
  r.valueType = Number(barcode[2]);
  if (![6, 7, 8, 9].includes(r.valueType)) {
    r.errors.push('Identificador de valor inválido (3º dígito deve ser 6, 7, 8 ou 9).');
    return;
  }
  r.line = collectionBarcodeToLine(barcode);
  r.lineFormatted = formatCollectionLine(r.line);
  const effective = r.valueType === 6 || r.valueType === 8;
  r.amountCents = Number(barcode.slice(4, 15));
  r.amount = effective ? r.amountCents / 100 : null;
  if (!effective) r.warnings.push('Valor de referência (não é o valor a pagar). Confira na conta.');
  const idLen = r.segment === 6 ? 8 : 4;
  r.companyId = barcode.slice(15, 15 + idLen);
  r.dueDateHint = findDateHint(barcode.slice(15 + idLen), referenceISO);
  r.warnings.push(r.dueDateHint
    ? 'Concessionárias não padronizam o vencimento: data sugerida a partir do campo livre, confira.'
    : 'Concessionárias não padronizam o vencimento na linha: informe a data da conta.');
  const mod = collectionModulo(r.valueType);
  const expected = mod(barcode.slice(0, 3) + barcode.slice(4));
  if (expected !== Number(barcode[3])) {
    r.errors.push(`Dígito verificador geral inválido (esperado ${expected}).`);
  }
}

/**
 * Decodifica uma linha digitável ou código de barras.
 * @param {string} input
 * @param {{reference?: string}} [opts] reference = data ISO usada para escolher o ciclo do fator (padrão: hoje)
 */
export function parseBoleto(input, opts = {}) {
  const digits = onlyDigits(input);
  const r = emptyResult(input, digits);
  const ref = opts.reference;

  if (digits.length === 47) {
    r.format = 'line47';
    const fields = [
      [digits.slice(0, 9), digits[9], 1],
      [digits.slice(10, 20), digits[20], 2],
      [digits.slice(21, 31), digits[31], 3],
    ];
    for (const [body, dv, n] of fields) {
      const expected = mod10(body);
      if (expected !== Number(dv)) r.errors.push(`Campo ${n}: dígito verificador inválido (esperado ${expected}).`);
    }
    const barcode = digits.slice(0, 4) + digits[32] + digits.slice(33, 47)
      + digits.slice(4, 9) + digits.slice(10, 20) + digits.slice(21, 31);
    fillBank(r, barcode, ref);
  } else if (digits.length === 44) {
    r.format = 'barcode44';
    if (digits[0] === '8') fillCollection(r, digits, ref);
    else fillBank(r, digits, ref);
  } else if (digits.length === 48) {
    r.format = 'line48';
    if (digits[0] !== '8') {
      r.errors.push('Linha de 48 dígitos deve começar com 8 (arrecadação).');
    } else {
      const valueType = Number(digits[2]);
      const mod = collectionModulo(valueType);
      let barcode = '';
      for (let i = 0; i < 4; i++) {
        const block = digits.slice(i * 12, i * 12 + 11);
        const dv = Number(digits[i * 12 + 11]);
        if ([6, 7, 8, 9].includes(valueType)) {
          const expected = mod(block);
          if (expected !== dv) r.errors.push(`Bloco ${i + 1}: dígito verificador inválido (esperado ${expected}).`);
        }
        barcode += block;
      }
      fillCollection(r, barcode, ref);
    }
  } else {
    r.errors.push(digits.length === 0
      ? 'Cole a linha digitável ou o código de barras.'
      : `Esperado 44, 47 ou 48 dígitos — recebi ${digits.length}.`);
  }

  r.isValid = r.errors.length === 0 && r.kind !== null;
  return r;
}

/** Monta um boleto bancário válido (usado no modo demonstração e nos testes). */
export function encodeBankBoleto({ bankCode = '237', currency = '9', dueDate, amount, freeField = '' }) {
  const factor = dueDate ? String(dateToFactor(dueDate)).padStart(4, '0') : '0000';
  const value = String(Math.round(amount * 100)).padStart(10, '0');
  if (value.length > 10) throw new RangeError('Valor acima do suportado pelo boleto.');
  const free = onlyDigits(freeField).padEnd(25, '0').slice(0, 25);
  const partial = String(bankCode).padStart(3, '0') + currency + factor + value + free;
  const dv = mod11Bank(partial);
  const barcode = partial.slice(0, 4) + dv + partial.slice(4);
  const line = bankBarcodeToLine(barcode);
  return { barcode, line, lineFormatted: formatBankLine(line) };
}

/** Monta um boleto de arrecadação válido (testes/demonstração). */
export function encodeCollectionBoleto({ segment = 3, valueType = 6, amount, companyId = '0000', freeField = '' }) {
  const value = String(Math.round(amount * 100)).padStart(11, '0');
  const idLen = segment === 6 ? 8 : 4;
  const company = onlyDigits(companyId).padStart(idLen, '0').slice(0, idLen);
  const free = onlyDigits(freeField).padEnd(44 - 15 - idLen, '0').slice(0, 44 - 15 - idLen);
  const partial = `8${segment}${valueType}` + value + company + free;
  const dv = collectionModulo(valueType)(partial);
  const barcode = partial.slice(0, 3) + dv + partial.slice(3);
  const line = collectionBarcodeToLine(barcode);
  return { barcode, line, lineFormatted: formatCollectionLine(line) };
}
