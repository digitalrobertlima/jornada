// Schema v2.0 — tipos, rótulos e normalizadores.
// Os normalizadores aceitam os nomes do SPEC original (ex.: `availableLimit`,
// `profileShareAmount`) e devolvem o formato canônico usado pelos motores.

import { num, round2 } from './util.js';

export const SCHEMA_VERSION = '2.0';

export const ACCOUNT_TYPES = {
  checking_cash: { label: 'Conta / Dinheiro (Pix, livre)', short: 'Liquidez real', real: true },
  benefit_card: { label: 'Vale / Cartão Benefício (travado)', short: 'Saldo travado', real: false },
  credit_card: { label: 'Cartão de Crédito', short: 'Limite (não é seu)', real: false },
  collateralized_yield_crypto: { label: 'Cartão com Garantia (BTC)', short: 'Garantia + yield', real: false },
};

export const OBLIGATION_TYPES = {
  vital_fixed: 'Conta vital',
  boleto: 'Boleto',
  card_debt: 'Cartão de crédito',
  personal_debt: 'Pix / Pessoa',
  financing: 'Financiamento',
  legacy_debt: 'Dívida antiga',
};

export const VITAL_KINDS = {
  moradia: 'Moradia',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  pensao: 'Pensão alimentícia',
  trabalho: 'Ferramenta de trabalho',
  contas: 'Luz / Água / Gás',
  saude: 'Saúde',
  educacao: 'Educação',
};

export const BUCKETS = { pessoal: 'Pessoal', negocio: 'Negócio', casa: 'Casa', familia: 'Família' };

export const ZONES = {
  frontline: { n: 1, name: 'Linha de Frente', short: 'Zona 1' },
  battlefield: { n: 2, name: 'Campo de Batalha', short: 'Zona 2' },
  quarantine: { n: 3, name: 'Domo de Quarentena', short: 'Zona 3' },
};

export const DEFAULT_PROTEST_FEE = 210;

export function isRealLiquidity(acc) {
  if (!acc) return false;
  if (acc.type !== 'checking_cash') return false;
  return acc.isRealLiquidity !== false;
}

export function normalizeProfile(p) {
  const out = { ...p };
  out.name = String(p.name || 'Perfil').slice(0, 40);
  out.monthlyNetIncome = num(p.monthlyNetIncome);
  if (p.monthlyWorkHours == null && p.monthlyCommuteHours == null && p.monthlyWorkAndCommuteHours != null) {
    out.monthlyWorkHours = num(p.monthlyWorkAndCommuteHours);
    out.monthlyCommuteHours = 0;
  } else {
    out.monthlyWorkHours = num(p.monthlyWorkHours);
    out.monthlyCommuteHours = num(p.monthlyCommuteHours);
  }
  out.monthlyWorkAndCommuteHours = out.monthlyWorkHours + out.monthlyCommuteHours;
  out.realHourlyRate = out.monthlyWorkAndCommuteHours > 0
    ? round2(out.monthlyNetIncome / out.monthlyWorkAndCommuteHours) : 0;
  out.currentEra = num(p.currentEra, 1) || 1;
  out.rescuedLifeMinutes = num(p.rescuedLifeMinutes);
  out.accumulatedSats = Math.floor(num(p.accumulatedSats));
  out.shieldTarget = num(p.shieldTarget, 500) || 500;
  out.rescueLog = Array.isArray(p.rescueLog) ? p.rescueLog : [];
  out.eraLog = Array.isArray(p.eraLog) ? p.eraLog : [];
  out.satsLog = Array.isArray(p.satsLog) ? p.satsLog : [];
  out.baselines = p.baselines && typeof p.baselines === 'object' ? p.baselines : {};
  out.selfCustody = p.selfCustody && typeof p.selfCustody === 'object'
    ? p.selfCustody : { btcAddress: '', polygonAddress: '', checklist: {} };
  out.selfCustody.checklist = out.selfCustody.checklist || {};
  out.hue = num(p.hue, 190);
  return out;
}

export function normalizeAccount(a) {
  const out = { ...a };
  out.name = String(a.name || ACCOUNT_TYPES[a.type]?.label || 'Conta').slice(0, 40);
  if (!ACCOUNT_TYPES[out.type]) out.type = 'checking_cash';
  out.isRealLiquidity = out.type === 'checking_cash' ? a.isRealLiquidity !== false : false;
  switch (out.type) {
    case 'checking_cash':
      out.balance = round2(a.balance);
      break;
    case 'benefit_card':
      out.balance = round2(a.balance);
      out.lock = ['alimentacao', 'transporte', 'outro'].includes(a.lock) ? a.lock : 'alimentacao';
      break;
    case 'credit_card':
      out.limitTotal = round2(a.limitTotal);
      out.limitAvailable = round2(a.limitAvailable ?? a.availableLimit ?? a.limitTotal);
      out.limitShrinking = Boolean(a.limitShrinking);
      out.closingDay = num(a.closingDay) || null;
      out.dueDay = num(a.dueDay) || null;
      out.limitHistory = Array.isArray(a.limitHistory) ? a.limitHistory : [];
      delete out.availableLimit;
      break;
    case 'collateralized_yield_crypto': {
      out.collateralTotal = round2(a.collateralTotal);
      out.lockedInstallments = round2(Math.min(num(a.lockedInstallments), out.collateralTotal));
      // invariante: limite livre = garantia total − garantia travada em parcelas
      out.limitAvailable = round2(out.collateralTotal - out.lockedInstallments);
      out.yieldConfig = {
        cdiPercent: num(a.yieldConfig?.cdiPercent, 100),
        cashbackPercent: num(a.yieldConfig?.cashbackPercent, 0.5),
        payoutAsset: a.yieldConfig?.payoutAsset || 'BTC',
      };
      out.satsFromYield = Math.floor(num(a.satsFromYield));
      out.satsFromCashback = Math.floor(num(a.satsFromCashback));
      out.yieldPendingBRL = num(a.yieldPendingBRL);
      out.cashbackPendingBRL = num(a.cashbackPendingBRL);
      out.yieldBRLTotal = num(a.yieldBRLTotal);
      out.cashbackBRLTotal = num(a.cashbackBRLTotal);
      out.yieldAccruedUntil = a.yieldAccruedUntil || null;
      delete out.availableLimit;
      break;
    }
    default:
      break;
  }
  return out;
}

export function normalizeObligation(o) {
  const out = { ...o };
  if (!OBLIGATION_TYPES[out.type]) out.type = 'boleto';
  out.beneficiary = String(o.beneficiary || OBLIGATION_TYPES[out.type]).slice(0, 60);
  out.bucket = BUCKETS[o.bucket] ? o.bucket : 'pessoal';
  out.zone = ZONES[o.zone] ? o.zone : null; // null = triagem automática
  const base = o.balance ?? o.totalAmount ?? o.principalAmount ?? 0;
  out.principalAmount = round2(o.principalAmount ?? o.totalAmount ?? base);
  out.totalAmount = round2(o.totalAmount ?? o.principalAmount ?? base);
  out.balance = round2(base);
  out.isShared = Boolean(o.isShared);
  if (out.isShared) {
    if (o.shareMode) out.shareMode = o.shareMode;
    else if (o.fixedShare) out.shareMode = 'fixed';
    else if (o.splitRatio) out.shareMode = 'ratio';
    else if (o.profileShareAmount != null && o.profileId) {
      out.shareMode = 'fixed';
      out.fixedShare = { [o.profileId]: round2(o.profileShareAmount) };
    } else out.shareMode = 'equal';
    out.paidShares = o.paidShares && typeof o.paidShares === 'object' ? o.paidShares : {};
  }
  const rules = o.rules || {};
  out.rules = {
    finePercent: num(rules.finePercent),
    dailyInterestPercent: num(rules.dailyInterestPercent),
    canProtest: Boolean(rules.canProtest),
    protestDeadline: rules.protestDeadline || null,
    estimatedProtestFee: rules.canProtest ? num(rules.estimatedProtestFee, DEFAULT_PROTEST_FEE) : num(rules.estimatedProtestFee),
  };
  out.monthlyInterestPercent = num(o.monthlyInterestPercent);
  out.installmentAmount = num(o.installmentAmount) || null;
  const blank = (x) => x == null || x === '';
  out.installmentsLeft = blank(o.installmentsLeft) ? null : Math.max(0, Math.round(num(o.installmentsLeft)));
  out.installmentsTotal = blank(o.installmentsTotal)
    ? out.installmentsLeft
    : Math.max(out.installmentsLeft ?? 0, Math.round(num(o.installmentsTotal)));
  if (!out.installmentAmount) {
    out.installmentsLeft = null;
    out.installmentsTotal = null;
  }
  out.recurrence = o.recurrence === 'monthly' ? 'monthly' : null;
  out.isLegacy = Boolean(o.isLegacy) || out.type === 'legacy_debt';
  out.isWorkTool = Boolean(o.isWorkTool);
  out.protested = Boolean(o.protested);
  out.protestRescued = Boolean(o.protestRescued);
  out.settlementDiscountPercent = num(o.settlementDiscountPercent, 80);
  out.status = o.status === 'paid' ? 'paid' : 'open';
  out.dueDate = o.dueDate || null;
  return out;
}

/** Situação do parcelamento de uma dívida (qualquer tipo), ou null se não for parcelada. */
export function installmentInfo(ob) {
  const amount = num(ob?.installmentAmount);
  if (!(amount > 0)) return null;
  const left = ob.installmentsLeft == null ? null : num(ob.installmentsLeft);
  const total = ob.installmentsTotal == null ? left : num(ob.installmentsTotal);
  const paid = total != null && left != null ? Math.max(0, total - left) : null;
  const current = total ? Math.min(total, (paid ?? 0) + 1) : null;
  const label = total === 1 ? 'parcela única' : total ? (left === 1 ? `última parcela (${total}/${total})` : `parcela ${current}/${total}`) : 'parcelado';
  return { amount, left, total, paid, current, label };
}

export function normalizeLedger(e) {
  const out = { ...e };
  out.direction = e.direction === 'in' ? 'in' : 'out';
  out.amount = round2(Math.abs(num(e.amount)));
  out.status = e.status === 'scheduled' ? 'scheduled' : 'posted';
  out.category = String(e.category || (out.direction === 'in' ? 'entrada' : 'gasto')).slice(0, 40);
  out.installments = num(e.installments, 1) || 1;
  out.forecast = Boolean(e.forecast) && out.status === 'scheduled' && out.direction === 'in';
  if (e.liquidity) out.liquidity = e.liquidity === 'locked' ? 'locked' : 'pix';
  if (!out.forecast) { delete out.repeat; } else out.repeat = e.repeat === 'monthly' ? 'monthly' : null;
  return out;
}

export function normalizeHousehold(h) {
  return {
    id: 'main',
    name: String(h?.name || 'Núcleo Familiar').slice(0, 40),
    sharedWaterlineMonthly: round2(h?.sharedWaterlineMonthly),
  };
}

/** Normaliza o estado inteiro (importação de backup, migração do formato do SPEC). */
export function normalizeState(raw) {
  const profiles = (raw.profiles || []).filter((p) => p && p.id).map(normalizeProfile);
  return {
    household: normalizeHousehold(raw.household),
    profiles,
    accounts: (raw.accounts || []).filter((a) => a && a.id).map(normalizeAccount),
    obligations: (raw.obligations || []).filter((o) => o && o.id).map(normalizeObligation),
    ledger: (raw.ledger || []).filter((e) => e && e.id).map(normalizeLedger),
  };
}
