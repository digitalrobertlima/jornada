// "Quando eu vou respirar?" — projeção mês a mês de quando as dívidas acabam,
// seguindo o mesmo plano do app: essenciais primeiro, parcelas em dia, reserva pequena,
// e todo o resto atacando as dívidas na ordem da fila. É uma estimativa com hipóteses claras.

import { addMonths } from '../core/dates.js';
import { num, round2 } from '../core/util.js';
import { memberIds, shareAmount } from './triage.js';
import { pendingForecasts } from './forecast.js';
import { realLiquidity } from './cashflow.js';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthLabel = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const ym = (iso) => iso.slice(0, 7);

/**
 * @param tri resultado da triagem do perfil
 * @returns {{
 *   ok: boolean, months: number|null, date: string|null, monthsAll: number|null, dateAll: string|null,
 *   monthlyIncome: number, monthlyEssentials: number, monthlyFree: number, debtTotal: number,
 *   milestones: {name:string, date:string}[], assumptions: string[], shortfall: number, usedProfileIncome: boolean
 * }}
 */
export function projectFreedom(state, pid, today, tri, { reserveTarget = 500, maxMonths = 120 } = {}) {
  const profile = state.profiles.find((p) => p.id === pid);
  const members = memberIds(state);
  const start = `${today.slice(0, 7)}-01`;
  const assumptions = [];

  // entradas: previsões (as mensais se repetem); sem previsão, usa a renda do perfil
  const fc = pendingForecasts(state, pid);
  const liquidFc = fc.filter((e) => e.liquidity !== 'locked');
  const hasMonthly = liquidFc.some((e) => e.repeat === 'monthly');
  const profileIncome = num(profile?.monthlyNetIncome);
  // sem entrada mensal cadastrada, a renda do perfil assume depois das entradas avulsas previstas
  const lastOneOff = liquidFc.reduce((m, e) => (ym(e.date) > m ? ym(e.date) : m), ym(today));
  const usedProfileIncome = !hasMonthly && profileIncome > 0;
  const incomeIn = (monthISO, locked) => {
    let s = 0;
    for (const e of fc) {
      if ((e.liquidity === 'locked') !== locked) continue;
      const first = ym(e.date < today ? today : e.date);
      if (e.repeat === 'monthly' ? monthISO >= first : monthISO === first) s += num(e.amount);
    }
    if (!locked && usedProfileIncome && monthISO > lastOneOff) s += profileIncome;
    return s;
  };
  if (usedProfileIncome) assumptions.push('a renda mensal do seu perfil continua entrando depois das entradas previstas');
  else if (hasMonthly) assumptions.push('as entradas marcadas como "todo mês" continuam caindo');
  else assumptions.push('só entram as entradas previstas (cadastre o salário como "todo mês" para uma projeção melhor)');

  // essenciais: o que é mensal se repete; o que vence ainda este mês entra no mês atual
  const vital = [...tri.frontline, ...tri.battlefield].filter((i) => i.isVital);
  const monthlyShare = (i) => (i.ob.isShared ? shareAmount(i.ob, pid, members) : num(i.ob.totalAmount) || i.open);
  const monthlyEssentials = round2(vital.filter((i) => i.ob.recurrence === 'monthly').reduce((s, i) => s + monthlyShare(i), 0));
  const foodTransport = round2(vital.filter((i) => i.ob.recurrence === 'monthly' && ['alimentacao', 'transporte'].includes(i.ob.vitalKind)).reduce((s, i) => s + monthlyShare(i), 0));
  const essentialsNow = round2(vital.reduce((s, i) => s + i.dueNow, 0));

  // dívidas na ordem da fila (urgentes primeiro, depois a ordem do app); quarentena por último
  const queue = [...tri.frontline, ...tri.battlefield].filter((i) => !i.isVital);
  const later = tri.quarantine.filter((i) => !i.isVital);
  const debts = [...queue, ...later].map((i) => ({
    id: i.id, start: round2(i.updated), paid: [], bal: [],
    name: i.ob.beneficiary, balance: round2(i.updated), inst: i.installment ? num(i.installment.amount) : 0,
    rate: i.installment ? 0 : num(i.ob.monthlyInterestPercent) / 100, quarantine: i.zone === 'quarantine', doneAt: null,
    urgent: i.zone === 'frontline' || i.late > 0,
  }));
  const debtTotal = round2(debts.reduce((s, d) => s + d.balance, 0));
  if (debts.some((d) => d.rate > 0)) assumptions.push('os juros cadastrados continuam iguais');
  assumptions.push('você não faz dívida nova');

  let carry = realLiquidity(state, pid);
  let reserve = 0;
  let months = null;
  let monthsAll = null;
  let worst = 0;
  const monthEnd = [];
  for (let m = 0; m < maxMonths; m++) {
    const monthISO = ym(addMonths(start, m));
    const label = `${monthISO}-01`;
    if (m > 0) for (const d of debts) if (d.balance > 0.004 && d.rate > 0) d.balance = round2(d.balance * (1 + d.rate));
    const locked = incomeIn(monthISO, true);
    const need = m === 0 ? essentialsNow : round2(monthlyEssentials - Math.min(locked, foodTransport));
    let avail = round2(carry + incomeIn(monthISO, false) - need);
    // parcelas em dia
    for (const d of debts) {
      if (d.balance <= 0.004 || !d.inst || d.quarantine) continue;
      const pay = round2(Math.min(d.inst, d.balance, Math.max(0, avail)));
      d.balance = round2(d.balance - pay);
      avail = round2(avail - pay);
      if (pay > 0) d.paid.push({ m, amount: pay });
    }
    const income = round2(incomeIn(monthISO, false));
    if (avail < 0) {
      worst = Math.min(worst, avail);
      carry = avail;
      for (const d of debts) d.bal[m] = d.balance;
      monthEnd.push({ m, income, essentials: need, carry, reserve });
      continue;
    }
    const attack = (list) => {
      for (const d of list) {
        if (avail <= 0.004) break;
        if (d.balance <= 0.004) continue;
        const pay = round2(Math.min(avail, d.balance));
        d.balance = round2(d.balance - pay);
        avail = round2(avail - pay);
        if (pay > 0) d.paid.push({ m, amount: pay });
      }
    };
    // 1) urgentes (atrasadas, risco de cartório) 2) reserva pequena 3) resto da fila 4) guardadas para depois
    attack(debts.filter((d) => d.urgent && !d.quarantine));
    const toReserve = round2(Math.min(avail, Math.max(0, reserveTarget - reserve)));
    reserve = round2(reserve + toReserve);
    avail = round2(avail - toReserve);
    attack(debts.filter((d) => !d.quarantine));
    if (debts.every((d) => d.quarantine || d.balance <= 0.004)) attack(debts.filter((d) => d.quarantine));
    for (const d of debts) if (d.balance <= 0.004 && !d.doneAt) d.doneAt = label;
    carry = avail;
    for (const d of debts) d.bal[m] = d.balance;
    monthEnd.push({ m, income, essentials: need, carry, reserve });
    if (months === null && debts.every((d) => d.quarantine || d.balance <= 0.004)) months = m;
    if (monthsAll === null && debts.every((d) => d.balance <= 0.004)) monthsAll = m;
    // depois de tudo quitado, segue alguns meses para mostrar a sobra crescendo
    if (monthsAll !== null && m >= monthsAll + 12) break;
  }
  const nextMonth = ym(addMonths(start, Math.max(1, (Number(lastOneOff.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(lastOneOff.slice(5, 7)) - Number(today.slice(5, 7)) + 1)));
  const monthlyIncome = round2(incomeIn(nextMonth, false));
  const monthlyFree = round2(monthlyIncome - (monthlyEssentials - Math.min(incomeIn(nextMonth, true), foodTransport)));
  const toDate = (n) => (n === null ? null : `${ym(addMonths(start, n))}-01`);
  return {
    ok: months !== null,
    months, date: toDate(months), monthsAll, dateAll: toDate(monthsAll),
    monthlyIncome, monthlyEssentials, monthlyFree, debtTotal,
    milestones: debts.filter((d) => d.doneAt).sort((a, b) => a.doneAt.localeCompare(b.doneAt)).map((d) => ({ name: d.name, date: d.doneAt })),
    hasLater: later.length > 0,
    shortfall: round2(Math.max(0, -Math.min(0, (incomeIn(nextMonth, false) - (monthlyEssentials - Math.min(incomeIn(nextMonth, true), foodTransport))))) + (worst < 0 ? 0 : 0)),
    usedProfileIncome,
    assumptions,
    start,
    monthEnd,
    debts: debts.map((d) => ({ id: d.id, name: d.name, start: d.start, paid: d.paid, bal: d.bal, quarantine: d.quarantine, doneAt: d.doneAt })),
  };
}

/**
 * Fotografia da projeção no fim do mês h-1 (h = quantos meses contar, 1 = só este mês).
 * Para cada dívida: quanto foi pago no período, quanto falta e quando ela some (se sumir).
 */
export function atHorizon(proj, h) {
  const last = Math.min(h, proj.monthEnd.length) - 1;
  const end = proj.monthEnd[last] || { carry: 0, reserve: 0 };
  const per = new Map();
  for (const d of proj.debts) {
    const paid = round2(d.paid.filter((p) => p.m <= last).reduce((s, p) => s + p.amount, 0));
    const left = round2(d.bal[last] ?? d.start);
    const doneM = d.doneAt ? Math.round((Number(d.doneAt.slice(0, 4)) - Number(proj.start.slice(0, 4))) * 12 + Number(d.doneAt.slice(5, 7)) - Number(proj.start.slice(5, 7))) : null;
    per.set(d.id, { paid, left, done: doneM !== null && doneM <= last, doneAt: doneM !== null && doneM <= last ? d.doneAt : null, firstPay: d.paid.find((p) => p.m <= last) ? `${addMonths(proj.start, d.paid.find((p) => p.m <= last).m).slice(0, 7)}-01` : null });
  }
  const months = proj.monthEnd.slice(0, last + 1);
  const income = round2(months.reduce((s, x) => s + x.income, 0));
  const essentials = round2(months.reduce((s, x) => s + x.essentials, 0));
  const toDebts = round2(proj.debts.reduce((s, d) => s + d.paid.filter((p) => p.m <= last).reduce((a, p) => a + p.amount, 0), 0));
  const missing = round2(proj.debts.filter((d) => !d.quarantine).reduce((s, d) => s + (d.bal[last] ?? d.start), 0));
  return {
    last, endDate: `${addMonths(proj.start, last).slice(0, 7)}-01`, per,
    income, essentials, toDebts, missing,
    leftover: round2(end.carry + end.reserve), reserve: round2(end.reserve),
  };
}
