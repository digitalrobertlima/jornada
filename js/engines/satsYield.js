// Gotejamento de Satoshis do cartão com garantia (modelo Bipa):
// rendimento de X% do CDI sobre a garantia total + cashback, pagos em BTC.

import { businessDaysBetween } from '../core/dates.js';
import { clone, num, round2 } from '../core/util.js';

export const SATS_PER_BTC = 1e8;

export function dailyCdiFactor(cdiAnnualPercent, cdiPercent = 100) {
  const daily = Math.pow(1 + num(cdiAnnualPercent) / 100, 1 / 252) - 1;
  return daily * num(cdiPercent) / 100;
}

export function brlToSats(brl, btcPrice) {
  if (!(btcPrice > 0)) return 0;
  return Math.floor(num(brl) / btcPrice * SATS_PER_BTC);
}

export function satsToBRL(sats, btcPrice) {
  if (!(btcPrice > 0)) return 0;
  return round2(num(sats) / SATS_PER_BTC * btcPrice);
}

/** Acumula rendimento em dias úteis desde a última apuração. Devolve a conta atualizada ou null. */
export function accrueYield(account, { today, cdiAnnual, btcPrice }) {
  if (account.type !== 'collateralized_yield_crypto') return null;
  const acc = clone(account);
  if (!acc.yieldAccruedUntil) {
    acc.yieldAccruedUntil = today;
    return acc;
  }
  const days = businessDaysBetween(acc.yieldAccruedUntil, today);
  let changed = false;
  if (days > 0 && num(cdiAnnual) > 0) {
    const factor = Math.pow(1 + dailyCdiFactor(cdiAnnual, acc.yieldConfig?.cdiPercent), days) - 1;
    const brl = num(acc.collateralTotal) * factor;
    acc.yieldPendingBRL = num(acc.yieldPendingBRL) + brl;
    acc.yieldBRLTotal = round2(num(acc.yieldBRLTotal) + brl);
    acc.yieldAccruedUntil = today;
    changed = true;
  }
  if (btcPrice > 0) {
    for (const [pending, target] of [['yieldPendingBRL', 'satsFromYield'], ['cashbackPendingBRL', 'satsFromCashback']]) {
      const s = brlToSats(acc[pending], btcPrice);
      if (s > 0) {
        acc[target] = num(acc[target]) + s;
        acc[pending] = Math.max(0, num(acc[pending]) - s * btcPrice / SATS_PER_BTC);
        changed = true;
      }
    }
  }
  return changed ? acc : null;
}

/** Projeção mensal (21 dias úteis) do rendimento da garantia. */
export function monthlyYieldProjection(account, { cdiAnnual, btcPrice }) {
  const factor = Math.pow(1 + dailyCdiFactor(cdiAnnual, account.yieldConfig?.cdiPercent), 21) - 1;
  const brl = round2(num(account.collateralTotal) * factor);
  return { brl, sats: brlToSats(brl, btcPrice) };
}

/** Placar unificado de Satoshis de um perfil. */
export function satsScore(state, profileId) {
  const profile = state.profiles.find((p) => p.id === profileId);
  let yieldSats = 0;
  let cashbackSats = 0;
  for (const a of state.accounts) {
    if (a.profileId !== profileId || a.type !== 'collateralized_yield_crypto') continue;
    yieldSats += num(a.satsFromYield);
    cashbackSats += num(a.satsFromCashback);
  }
  const direct = Math.floor(num(profile?.accumulatedSats));
  return { direct, yieldSats, cashbackSats, total: direct + yieldSats + cashbackSats };
}
