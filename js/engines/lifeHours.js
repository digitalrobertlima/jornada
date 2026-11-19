// Conversor de Hora de Vida Real.
// valorHoraReal = rendaLiquidaMensal / (horasTrabalhadasMes + horasDeslocamentoMes)

import { diffDays } from '../core/dates.js';
import { num, round2 } from '../core/util.js';

export function monthlyHours(profile) {
  const split = num(profile.monthlyWorkHours) + num(profile.monthlyCommuteHours);
  return split > 0 ? split : num(profile.monthlyWorkAndCommuteHours);
}

export function realHourlyRate(profile) {
  const hours = monthlyHours(profile);
  const income = num(profile.monthlyNetIncome);
  if (hours <= 0 || income <= 0) return 0;
  return income / hours;
}

/** Valor em R$ → minutos de vida. */
export function moneyToMinutes(amount, rate) {
  if (!rate || rate <= 0) return 0;
  return (num(amount) / rate) * 60;
}

export function minutesToMoney(minutes, rate) {
  return round2((num(minutes) / 60) * num(rate));
}

/** Minutos de vida → dias de trabalho (jornada média = horas do mês / 22). */
export function minutesToWorkdays(minutes, profile) {
  const perDay = monthlyHours(profile) / 22;
  if (perDay <= 0) return 0;
  return num(minutes) / 60 / perDay;
}

/** Saldo atualizado de um boleto em atraso (multa única + juros diários simples). */
export function overdueAmount(balance, rules, daysLate) {
  if (!rules || daysLate <= 0) return round2(balance);
  const fine = balance * num(rules.finePercent) / 100;
  const interest = balance * num(rules.dailyInterestPercent) / 100 * daysLate;
  return round2(balance + fine + interest);
}

/**
 * Sangria mensal de uma obrigação, em R$:
 *  - juros mensais sobre o saldo (cartão, financiamento, dívida antiga)
 *  - boleto: juros de 30 dias de atraso (+ multa, se já venceu)
 */
export function monthlyBleed(ob, today) {
  const balance = num(ob.balance);
  if (balance <= 0) return 0;
  if (num(ob.monthlyInterestPercent) > 0) return round2(balance * num(ob.monthlyInterestPercent) / 100);
  const rules = ob.rules || {};
  if (num(rules.dailyInterestPercent) > 0) {
    const late = ob.dueDate && today ? diffDays(ob.dueDate, today) : 0;
    const fine = late > 0 ? balance * num(rules.finePercent) / 100 : 0;
    return round2(balance * num(rules.dailyInterestPercent) / 100 * 30 + fine);
  }
  return 0;
}

/**
 * Dano bloqueado ao pagar `amount` de uma obrigação em `date`.
 * Cada componente é convertido depois em minutos de vida.
 */
export function rescueBreakdown(ob, amount, date, { fullPayment = false, discount = 0 } = {}) {
  const parts = [];
  const paid = num(amount);
  const rules = ob.rules || {};
  const beforeDue = ob.dueDate ? date <= ob.dueDate : true;

  if (fullPayment && rules.canProtest && !ob.protested && rules.protestDeadline && date <= rules.protestDeadline) {
    const fee = num(rules.estimatedProtestFee) || 0;
    if (fee > 0) parts.push({ kind: 'protest', label: 'Taxa de cartório evitada', amount: fee });
  }
  if (beforeDue && num(rules.finePercent) > 0 && paid > 0) {
    parts.push({ kind: 'fine', label: 'Multa por atraso evitada', amount: round2(paid * num(rules.finePercent) / 100) });
  }
  if (num(ob.monthlyInterestPercent) > 0 && paid > 0) {
    parts.push({ kind: 'interest', label: 'Juros de 1 mês evitados', amount: round2(paid * num(ob.monthlyInterestPercent) / 100) });
  } else if (!beforeDue && num(rules.dailyInterestPercent) > 0 && paid > 0) {
    parts.push({ kind: 'interest', label: 'Juros diários interrompidos (30 dias)', amount: round2(paid * num(rules.dailyInterestPercent) / 100 * 30) });
  }
  if (num(discount) > 0) parts.push({ kind: 'discount', label: 'Desconto negociado', amount: round2(discount) });

  const total = round2(parts.reduce((s, p) => s + p.amount, 0));
  return { parts, total };
}
