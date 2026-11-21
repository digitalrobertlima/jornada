// Previsão de entradas e plano de distribuição.
// Uma previsão é um lançamento de entrada agendado (`forecast: true`) que só vira saldo quando a
// pessoa confirma "caiu". O plano cruza o que vai entrar (livre via Pix ou travado em vale) com as
// contas que vencem, em ordem de prioridade, e mostra o que sobra e o que falta.

import { addDays, addMonths } from '../core/dates.js';
import { isRealLiquidity } from '../core/model.js';
import { num, round2, uid, clone } from '../core/util.js';
import { realLiquidity } from './cashflow.js';

export const INCOME_KINDS = {
  salario: { label: 'Salário', liquidity: 'pix', category: 'salário' },
  adiantamento: { label: 'Adiantamento', liquidity: 'pix', category: 'adiantamento' },
  vale_alimentacao: { label: 'Vale-alimentação / refeição', liquidity: 'locked', lock: 'alimentacao', category: 'benefício' },
  vale_transporte: { label: 'Vale-transporte', liquidity: 'locked', lock: 'transporte', category: 'benefício' },
  extra: { label: 'Extra / bico / venda', liquidity: 'pix', category: 'extra' },
  outro: { label: 'Outra entrada', liquidity: 'pix', category: 'outros' },
};

export const LOCKS = { alimentacao: 'Alimentação / mercado', transporte: 'Transporte', outro: 'Outro uso' };

export const isLockedAccount = (acc) => acc?.type === 'benefit_card';

/**
 * Lançamentos agendados comuns (não previsões) em conta Pix: ex. um vale pago em conta, um débito marcado.
 * Entram no plano e na projeção na data marcada (o app posta sozinho quando a data chega).
 */
export function scheduledLiquid(state, profileId, until = '9999-12-31') {
  const liquidIds = new Set(state.accounts.filter((a) => a.profileId === profileId && isRealLiquidity(a)).map((a) => a.id));
  return state.ledger
    .filter((e) => e.profileId === profileId && e.status === 'scheduled' && !e.forecast && !e.obligationId && liquidIds.has(e.accountId) && e.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Dinheiro livre que entra (previsões Pix + agendados) de hoje até `until`, já descontando saídas agendadas. */
export function liquidIncoming(state, profileId, today, until) {
  const list = [
    ...pendingForecasts(state, profileId).filter((e) => e.liquidity !== 'locked' && e.date <= until).map((e) => ({ date: e.date < today ? today : e.date, amount: num(e.amount), note: e.note, id: e.id })),
    ...scheduledLiquid(state, profileId, until).map((e) => ({ date: e.date, amount: e.direction === 'in' ? num(e.amount) : -num(e.amount), note: e.note || e.category, id: e.id })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return { list, total: round2(list.reduce((t, e) => t + e.amount, 0)) };
}

/**
 * As contas essenciais dos próximos dias fecham contando o que vai entrar antes de cada vencimento?
 * @returns {{ shortfall: number, worstDate: string|null, used: object[] }}
 */
export function essentialsCoverage(state, profileId, today, wl, cash) {
  const items = [...wl.items].sort((a, b) => String(a.ob.dueDate || today).localeCompare(String(b.ob.dueDate || today)));
  let need = 0;
  let shortfall = 0;
  let worstDate = null;
  let lastDate = today;
  for (const i of items) {
    const date = i.ob.dueDate && i.ob.dueDate > today ? i.ob.dueDate : today;
    need += num(i.dueNow);
    const have = cash + liquidIncoming(state, profileId, today, date).total;
    if (need - have > shortfall + 0.004) { shortfall = round2(need - have); worstDate = date; }
    lastDate = date;
  }
  return { shortfall: round2(shortfall), worstDate, used: liquidIncoming(state, profileId, today, lastDate).list.filter((e) => e.amount > 0) };
}

/** Transforma um lançamento agendado comum em previsão que se repete todo mês (ex.: vale pago em conta). */
export function scheduledToMonthly(state, entryId) {
  const e = state.ledger.find((x) => x.id === entryId);
  if (!e || e.status !== 'scheduled' || e.direction !== 'in') throw new Error('Esse lançamento não é uma entrada agendada.');
  const t = `${e.note || ''} ${e.category || ''}`.toLowerCase();
  const kind = /transporte/.test(t) ? 'vale_transporte' : /alimenta|refei/.test(t) ? 'vale_alimentacao' : /adiantamento|quinzena/.test(t) ? 'adiantamento' : /sal[aá]rio/.test(t) ? 'salario' : 'outro';
  const acc = state.accounts.find((a) => a.id === e.accountId);
  return { ledger: [{ ...e, forecast: true, repeat: 'monthly', kind, liquidity: acc && isRealLiquidity(acc) ? 'pix' : 'locked' }] };
}

/** Previsões ainda não confirmadas (inclui as atrasadas: eram para ter entrado). */
export function pendingForecasts(state, profileId) {
  return state.ledger
    .filter((e) => e.profileId === profileId && e.forecast && e.status === 'scheduled')
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Cria a previsão. Se a conta travada não existe, o chamador manda `newAccount`. */
export function addForecast(state, input, { today }) {
  const changes = { accounts: [], obligations: [], ledger: [], profiles: [], removeObligations: [] };
  const kind = INCOME_KINDS[input.kind] ? input.kind : 'outro';
  const info = INCOME_KINDS[kind];
  let accountId = input.accountId || null;
  if (!accountId && input.newAccount) {
    const acc = { id: uid('acc'), profileId: input.profileId, ...input.newAccount };
    changes.accounts.push(acc);
    accountId = acc.id;
  }
  const acc = changes.accounts.find((a) => a.id === accountId) || state.accounts.find((a) => a.id === accountId);
  const liquidity = acc ? (isRealLiquidity(acc) ? 'pix' : 'locked') : info.liquidity;
  const entry = {
    id: uid('tx'),
    profileId: input.profileId,
    date: input.date || today,
    direction: 'in',
    amount: round2(Math.abs(num(input.amount))),
    accountId,
    impactCashToday: acc ? isRealLiquidity(acc) : false,
    category: info.category,
    note: input.note || info.label,
    installments: 1,
    obligationId: null,
    status: 'scheduled',
    forecast: true,
    kind,
    liquidity,
    repeat: input.repeat === 'monthly' ? 'monthly' : null,
    createdAt: new Date().toISOString(),
  };
  changes.ledger.push(entry);
  return { changes, entry };
}

/** "Caiu!": transforma a previsão em saldo de verdade (valor e data reais). Repete no mês seguinte se for fixa. */
export function confirmForecast(state, entryId, { amount, date, today }) {
  const e = state.ledger.find((x) => x.id === entryId);
  const changes = { accounts: [], obligations: [], ledger: [], profiles: [], removeObligations: [] };
  if (!e || !e.forecast || e.status !== 'scheduled') return { changes, entry: null };
  const posted = { ...e, status: 'posted', forecast: false, date: date || today, amount: round2(Math.abs(num(amount, e.amount))) };
  changes.ledger.push(posted);
  const accRef = state.accounts.find((a) => a.id === e.accountId);
  if (accRef) {
    const acc = clone(accRef);
    acc.balance = round2(num(acc.balance) + posted.amount);
    changes.accounts.push(acc);
  }
  if (e.repeat === 'monthly') {
    changes.ledger.push({
      ...e, id: uid('tx'), date: addMonths(e.date, 1), amount: e.amount, createdAt: new Date().toISOString(),
    });
  }
  return { changes, entry: posted };
}

// ---------------------------------------------------------------------------
// Plano

function occurrencesOf(item, today, end) {
  const base = item.ob.dueDate || null;
  const out = [{ key: `${item.id}@0`, item, date: base, amount: item.dueNow, base: true }];
  const monthly = item.ob.recurrence === 'monthly';
  const left = item.installment && !item.ob.isShared ? item.installment.left : null;
  if (base && (monthly || (left && left > 1))) {
    const count = monthly ? 3 : left - 1;
    for (let n = 1; n <= count; n++) {
      const d = addMonths(base, n);
      if (d > end) break;
      out.push({ key: `${item.id}@${n}`, item, date: d, amount: item.dueNow, base: false });
    }
  }
  return out;
}

const poolFor = (item) => {
  const k = item.ob.vitalKind;
  return item.isVital && (k === 'alimentacao' || k === 'transporte') ? k : null;
};

/**
 * @returns {{moments, gaps, locked, cashNow, income, verdict, horizonEnd}}
 *  moments[]: { date, label, income, startBalance, lines[], reserve, leftover }
 *  lines[]: { key, id, name, amount, kind: 'conta'|'antecipar', paidWith: 'pix'|'vale', late }
 *  gaps[]: { id, name, missing, date, until }
 */
export function planDistribution(state, profileId, today, tri, { horizon = 45, reserveTarget = 500 } = {}) {
  const cashNow = realLiquidity(state, profileId);
  const accounts = state.accounts.filter((a) => a.profileId === profileId);

  // pools travados: saldo atual dos cartões benefício por finalidade
  const pools = { alimentacao: 0, transporte: 0, outro: 0 };
  for (const a of accounts.filter(isLockedAccount)) pools[a.lock || 'alimentacao'] += num(a.balance);

  const maxEnd = addDays(today, horizon);
  const pending = pendingForecasts(state, profileId).filter((e) => e.date <= maxEnd);
  // só avalia até onde a previsão alcança: contas depois da última entrada prevista (e além de 15 dias) ainda são "futuro sem previsão"
  const lastLiquid = [...pending.filter((e) => e.liquidity !== 'locked'), ...scheduledLiquid(state, profileId, maxEnd).filter((e) => e.direction === 'in')].reduce((m, e) => (e.date > m ? e.date : m), today);
  const end = [addDays(today, 15), lastLiquid].reduce((a, b) => (a > b ? a : b));
  // agendados comuns em conta Pix (ex.: vale pago em conta) também são dinheiro chegando — ou saindo
  const sched = scheduledLiquid(state, profileId, maxEnd).map((e) => ({ ...e, sched: true, amount: e.direction === 'in' ? num(e.amount) : -num(e.amount), note: e.note || e.category }));
  const liquid = [...pending.filter((e) => e.liquidity !== 'locked'), ...sched];
  const lockedIn = pending.filter((e) => e.liquidity === 'locked');
  const lockOf = (e) => INCOME_KINDS[e.kind]?.lock || accounts.find((a) => a.id === e.accountId)?.lock || 'alimentacao';

  // momentos de caixa: hoje + cada data com entrada livre
  const byDate = new Map();
  for (const e of liquid) {
    const d = e.date < today ? today : e.date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(e);
  }
  const dates = [...new Set([today, ...byDate.keys()])].sort();
  const moments = dates.map((date) => ({
    date, entries: byDate.get(date) || [], income: round2((byDate.get(date) || []).reduce((s, e) => s + e.amount, 0)),
    label: (byDate.get(date) || []).map((e) => e.note).join(' + '), lines: [], reserve: 0, startBalance: 0, leftover: 0,
    overdue: (byDate.get(date) || []).some((e) => e.date < today),
    dueToday: (byDate.get(date) || []).some((e) => e.date === today),
  }));

  // ocorrências a pagar
  const items = [...tri.frontline, ...tri.battlefield];
  const rankOf = new Map(items.map((i, n) => [i.id, n]));
  const occs = items.flatMap((i) => occurrencesOf(i, today, end)).filter((o) => o.date === null || o.date <= end);
  for (const o of occs) { o.left = o.amount; o.tierA = o.item.isVital || o.item.isProtestable || o.item.late > 0; }
  // ordem de pagamento: essenciais → cartório → atrasadas → o resto (nunca tira de conta essencial para pagar dívida)
  const prio = (o) => (o.item.isVital ? 0 : o.item.isProtestable ? 1 : o.item.late > 0 ? 2 : 3);

  let balance = cashNow;
  let reserveFilled = 0;
  const gaps = [];
  const gapSeen = new Set();
  const lockedUsed = { alimentacao: 0, transporte: 0, outro: 0 };
  const poolAt = (date) => {
    const p = { ...pools };
    for (const e of lockedIn) if (e.date <= date) p[lockOf(e)] += e.amount;
    for (const k of Object.keys(p)) p[k] = Math.max(0, p[k] - lockedUsed[k]);
    return p;
  };

  moments.forEach((m, idx) => {
    balance = round2(balance + m.income);
    m.startBalance = balance;
    const nextDate = moments[idx + 1]?.date || null;
    const windowEnd = nextDate || addDays(end, 1);
    const due = occs.filter((o) => o.left > 0.004 && o.date !== null && o.date < windowEnd)
      .sort((a, b) => prio(a) - prio(b) || a.date.localeCompare(b.date) || ((rankOf.get(a.item.id) ?? 0) - (rankOf.get(b.item.id) ?? 0)));
    // folga que precisa ficar guardada para as essenciais da PRÓXIMA janela que a próxima entrada não cobre
    const nextEnd = moments[idx + 2]?.date || addDays(end, 1);
    const nextVital = occs.filter((o) => o.left > 0.004 && o.date !== null && o.item.isVital && o.date >= windowEnd && o.date < nextEnd)
      .reduce((sum, o) => sum + o.left, 0);
    const holdBack = nextDate ? Math.max(0, round2(nextVital - (moments[idx + 1]?.income || 0))) : 0;
    for (const o of due) {
      // tudo ou nada: pagar metade do aluguel não resolve nada
      let need = o.left;
      let viaVale = 0;
      const lock = poolFor(o.item);
      if (lock) {
        viaVale = round2(Math.min(poolAt(m.date)[lock], need));
        need = round2(need - viaVale);
      }
      const usable = prio(o) === 0 ? balance : Math.max(0, balance - holdBack);
      if (need <= usable + 0.004) {
        if (lock) lockedUsed[lock] += viaVale;
        balance = round2(balance - need);
        o.left = 0;
        const g = gaps.find((x) => x.key === o.key);
        if (g) { g.resolvedAt = m.date; g.missing = 0; }
        if (viaVale > 0) m.lines.push({ key: o.key, id: o.item.id, name: o.item.ob.beneficiary, amount: viaVale, kind: 'conta', paidWith: 'vale', date: o.date, late: o.item.late });
        if (need > 0) m.lines.push({ key: o.key, id: o.item.id, name: o.item.ob.beneficiary, amount: need, kind: 'conta', paidWith: 'pix', date: o.date, late: o.item.late });
      } else {
        const rec = { id: o.item.id, name: o.item.ob.beneficiary, missing: round2(Math.max(0, need - usable)), have: round2(Math.max(0, usable)), amount: o.amount, date: o.date, until: nextDate, essential: o.tierA, resolvedAt: null };
        if (gapSeen.has(o.key)) Object.assign(gaps.find((g) => g.key === o.key), rec);
        else { gapSeen.add(o.key); gaps.push({ key: o.key, ...rec }); }
      }
    }
    const essentialOpen = occs.some((o) => o.left > 0.004 && o.date !== null && o.date < windowEnd && prio(o) <= 1);
    if (essentialOpen) { m.leftover = round2(balance); m.holding = true; return; }

    // o que precisa ficar guardado para as essenciais da próxima janela não entra nas próximas etapas
    const held = Math.min(balance, holdBack);
    balance = round2(balance - held);

    // reserva de segurança antes de adiantar dívida
    const needReserve = Math.max(0, reserveTarget - reserveFilled);
    m.reserve = round2(Math.min(balance, needReserve));
    reserveFilled += m.reserve;
    balance = round2(balance - m.reserve);

    // dívidas atrasadas que não cabem inteiras: paga uma parte (ligue e combine)
    for (const o of occs.filter((x) => x.left > 0.004 && x.date !== null && x.date < windowEnd).sort((a, b) => prio(a) - prio(b) || ((rankOf.get(a.item.id) ?? 0) - (rankOf.get(b.item.id) ?? 0)))) {
      if (balance <= 0.004) break;
      const pay = round2(Math.min(balance, o.left));
      balance = round2(balance - pay);
      o.left = round2(o.left - pay);
      m.lines.push({ key: o.key, id: o.item.id, name: o.item.ob.beneficiary, amount: pay, kind: 'conta', paidWith: 'pix', date: o.date, late: o.item.late, partial: o.left > 0.004 });
    }

    // sobra: adianta as dívidas da fila, na ordem do app (sem dívida de cartório/essencial já coberta)
    const extra = occs.filter((o) => o.left > 0.004 && o.base && !o.item.isVital && (o.date === null || o.date >= windowEnd))
      .sort((a, b) => (rankOf.get(a.item.id) ?? 0) - (rankOf.get(b.item.id) ?? 0));
    for (const o of extra) {
      if (balance <= 0.004) break;
      const pay = round2(Math.min(balance, o.left));
      balance = round2(balance - pay);
      o.left = round2(o.left - pay);
      m.lines.push({ key: o.key, id: o.item.id, name: o.item.ob.beneficiary, amount: pay, kind: 'antecipar', paidWith: 'pix', date: o.date, late: 0, partial: o.left > 0.004 });
    }
    balance = round2(balance + held);
    m.held = round2(held);
    m.leftover = round2(balance);
    // o que sobrou segue para o próximo momento (as contas dele são pagas primeiro)
  });

  const totalLocked = poolAt(end);
  const lockedList = Object.entries(totalLocked).filter(([, v]) => v > 0.004).map(([lock, amount]) => ({ lock, label: LOCKS[lock], amount: round2(amount) }));
  const incomeLiquid = round2(liquid.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0));
  const incomeLocked = round2(lockedIn.reduce((s, e) => s + e.amount, 0));
  const essentialGap = gaps.some((g) => g.essential);
  return {
    horizonEnd: end, cashNow, moments, gaps, locked: lockedList, incomeLiquid, incomeLocked,
    lockedIncomes: lockedIn, hasForecast: pending.length > 0,
    verdict: gaps.length ? (essentialGap ? 'short' : 'tight') : 'ok',
  };
}
