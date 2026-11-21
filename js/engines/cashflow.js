// Fluxo diário, Linha d'Água, Onda de Liquidez e ações sobre o ledger.
// As funções de ação NÃO mexem no estado: devolvem `changes` para o app salvar.

import { addDays, addMonths, diffDays, nextDayOfMonth } from '../core/dates.js';
import { isRealLiquidity } from '../core/model.js';
import { clone, num, round2, uid } from '../core/util.js';
import { triage, memberIds, openFor, shareAmount } from './triage.js';
import { moneyToMinutes, realHourlyRate, rescueBreakdown } from './lifeHours.js';

export const WATERLINE_DAYS = 15;

export function profileAccounts(state, profileId) {
  return state.accounts.filter((a) => a.profileId === profileId);
}

/** Caixa Livre Real: só conta corrente/dinheiro. Nunca limite, benefício ou garantia. */
export function realLiquidity(state, profileId) {
  return round2(profileAccounts(state, profileId).filter(isRealLiquidity).reduce((s, a) => s + num(a.balance), 0));
}

export function liquidityBreakdown(state, profileId) {
  const out = { real: 0, savings: 0, benefit: 0, creditAvailable: 0, collateralFree: 0, collateralLocked: 0, collateralTotal: 0 };
  for (const a of profileAccounts(state, profileId)) {
    if (isRealLiquidity(a)) out.real += num(a.balance);
    else if (a.type === 'benefit_card') out.benefit += num(a.balance);
    else if (a.type === 'savings_pot') out.savings += num(a.balance);
    else if (a.type === 'credit_card') out.creditAvailable += num(a.limitAvailable);
    else if (a.type === 'collateralized_yield_crypto') {
      out.collateralTotal += num(a.collateralTotal);
      out.collateralLocked += num(a.lockedInstallments);
      out.collateralFree += num(a.limitAvailable);
    }
  }
  for (const k of Object.keys(out)) out[k] = round2(out[k]);
  return out;
}

/** Linha d'Água: piso para cobrir vitais + protestáveis dos próximos 15 dias. */
export function waterline(state, profileId, today, tri = triage(state, profileId, today), horizon = WATERLINE_DAYS) {
  const end = addDays(today, horizon);
  const items = tri.frontline.filter((i) => (i.isVital || i.isProtestable) && (!i.ob.dueDate || i.ob.dueDate <= end));
  const floor = round2(items.reduce((s, i) => s + i.dueNow, 0));
  return { floor, items, end, horizon };
}

function cashEffect(entry) {
  if (!entry.impactCashToday) return 0;
  return entry.direction === 'in' ? num(entry.amount) : -num(entry.amount);
}

/** Onda de Liquidez: saldo real dia a dia (passado reconstruído + futuro agendado). */
export function liquidityWave(state, profileId, today, { back = 14, forward = WATERLINE_DAYS } = {}) {
  const cash = realLiquidity(state, profileId);
  const entries = state.ledger.filter((e) => e.profileId === profileId && e.impactCashToday);
  const posted = entries.filter((e) => e.status !== 'scheduled');
  const scheduled = entries.filter((e) => e.status === 'scheduled');
  const points = [];
  for (let i = -back; i <= forward; i++) {
    const date = addDays(today, i);
    let balance = cash;
    if (i < 0) {
      for (const e of posted) if (e.date > date && e.date <= today) balance -= cashEffect(e);
    } else if (i > 0) {
      for (const e of scheduled) if (e.date > today && e.date <= date) balance += cashEffect(e);
    }
    const dayEvents = (i <= 0 ? posted : scheduled).filter((e) => e.date === date);
    points.push({ date, offset: i, balance: round2(balance), events: dayEvents });
  }
  return points;
}

/** Status de cobertura da casa para obrigações compartilhadas dentro da janela. */
export function householdCoverage(state, today) {
  const members = memberIds(state);
  const end = addDays(today, WATERLINE_DAYS);
  const shared = state.obligations.filter((o) => o.isShared && o.status !== 'paid' && (!o.dueDate || o.dueDate <= end));
  if (!shared.length || members.length < 1) return null;
  const perMember = new Map();
  for (const pid of members) {
    const tri = triage(state, pid, today);
    const wl = waterline(state, pid, today, tri);
    const cash = realLiquidity(state, pid);
    perMember.set(pid, wl.floor > 0 ? Math.min(1, cash / wl.floor) : 1);
  }
  let total = 0;
  let covered = 0;
  const rows = shared.map((ob) => {
    const shares = members.map((pid) => {
      const share = shareAmount(ob, pid, members);
      const paid = num(ob.paidShares?.[pid]);
      const open = Math.max(0, share - paid);
      const cov = paid + open * perMember.get(pid);
      total += share;
      covered += cov;
      const profile = state.profiles.find((p) => p.id === pid);
      return { profileId: pid, name: profile?.name || pid, share, paid, open, covered: round2(cov), ok: cov >= share - 0.01 };
    });
    return { ob, shares, total: num(ob.totalAmount) };
  });
  return { rows, ratio: total > 0 ? covered / total : 1, total: round2(total), covered: round2(covered) };
}

// ---------------------------------------------------------------------------
// Ações (devolvem changes)

function emptyChanges() {
  return { accounts: [], obligations: [], ledger: [], profiles: [], removeObligations: [] };
}

function upsert(list, rec) {
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  return rec;
}

/** Vencimento da próxima fatura do cartão para uma compra feita em `date` (depois do fechamento cai na seguinte). */
export function invoiceDue(acc, date) {
  if (!acc?.dueDay) return addMonths(date, 1);
  const ref = acc.closingDay && Number(date.slice(8, 10)) > acc.closingDay ? addMonths(date, 1, 1) : date;
  return nextDayOfMonth(acc.dueDay, ref);
}

/** Cartões aceitam parcelamento, a menos que a pessoa marque que aquele não parcela. */
export const cardInstallments = (acc, wanted) => (['credit_card', 'collateralized_yield_crypto'].includes(acc?.type) && !acc.noInstallments ? Math.max(1, Math.round(num(wanted, 1)) || 1) : 1);

/** Compra parcelada no cartão: vira uma dívida própria com N parcelas (a fatura se divide em N partes). */
function installmentDebt(acc, entry, n) {
  const amount = num(entry.amount);
  return {
    id: uid('obl'), profileId: entry.profileId, type: 'card_debt', bucket: 'pessoal', zone: null,
    beneficiary: `${entry.note || entry.category} · ${acc.name} (${n}x)`, accountId: acc.id, sourceEntryId: entry.id,
    tower: entry.tower === 'separada' ? 'separada' : 'fatura', // onde mostrar: dentro da torre da fatura ou numa torre só dela
    principalAmount: amount, totalAmount: amount, balance: amount,
    installmentAmount: round2(amount / n), installmentsLeft: n, installmentsTotal: n,
    monthlyInterestPercent: 0, status: 'open', rules: {}, dueDate: invoiceDue(acc, entry.date), createdAt: entry.date,
  };
}

/** Aplica o efeito de um lançamento já postado sobre contas/obrigações. */
function applyEffects(state, entry, changes, { btcPrice } = {}) {
  const accRef = state.accounts.find((a) => a.id === entry.accountId);
  if (!accRef) return;
  const acc = upsert(changes.accounts, clone(changes.accounts.find((a) => a.id === accRef.id) || accRef));
  const amount = num(entry.amount);
  const sign = entry.direction === 'in' ? 1 : -1;
  switch (acc.type) {
    case 'checking_cash':
    case 'savings_pot':
    case 'benefit_card':
      acc.balance = round2(num(acc.balance) + sign * amount);
      break;
    case 'credit_card': {
      // compra (out) gasta limite e aumenta a fatura; estorno (in) devolve limite e abate a fatura
      acc.limitAvailable = round2(Math.max(0, Math.min(num(acc.limitTotal), num(acc.limitAvailable) + sign * amount)));
      const n = cardInstallments(acc, entry.installments);
      const isDebt = (o) => o.type === 'card_debt' && o.accountId === acc.id && o.status !== 'paid' && !o.installmentAmount;
      const existing = changes.obligations.find(isDebt) || state.obligations.find(isDebt);
      if (entry.direction === 'out' && n > 1) {
        upsert(changes.obligations, installmentDebt(acc, entry, n));
      } else if (entry.direction === 'out') {
        const debt = existing
          ? clone(changes.obligations.find((o) => o.id === existing.id) || existing)
          : {
            id: uid('obl'), profileId: entry.profileId, type: 'card_debt', bucket: 'pessoal', zone: null,
            beneficiary: `Fatura ${acc.name}`, accountId: acc.id, principalAmount: 0, totalAmount: 0, balance: 0,
            monthlyInterestPercent: 0, status: 'open', rules: {}, createdAt: entry.date,
          };
        if (!debt.dueDate && acc.dueDay) debt.dueDate = invoiceDue(acc, entry.date);
        debt.balance = round2(num(debt.balance) + amount);
        debt.principalAmount = round2(num(debt.principalAmount) + amount);
        debt.totalAmount = debt.balance;
        upsert(changes.obligations, debt);
      } else if (existing) {
        const debt = clone(changes.obligations.find((o) => o.id === existing.id) || existing);
        debt.balance = round2(Math.max(0, num(debt.balance) - amount));
        debt.principalAmount = round2(Math.max(0, num(debt.principalAmount) - amount));
        debt.totalAmount = debt.balance;
        upsert(changes.obligations, debt);
      }
      break;
    }
    case 'collateralized_yield_crypto': {
      if (entry.direction === 'in') {
        acc.collateralTotal = round2(num(acc.collateralTotal) + amount);
      } else {
        const n = cardInstallments(acc, entry.installments);
        if (n > 1) {
          acc.lockedInstallments = round2(num(acc.lockedInstallments) + amount);
          upsert(changes.obligations, installmentDebt(acc, entry, n));
        } else acc.collateralTotal = round2(num(acc.collateralTotal) - amount);
        const cb = amount * num(acc.yieldConfig?.cashbackPercent) / 100;
        acc.cashbackBRLTotal = round2(num(acc.cashbackBRLTotal) + cb);
        acc.cashbackPendingBRL = num(acc.cashbackPendingBRL) + cb;
        if (btcPrice > 0) {
          const s = Math.floor(acc.cashbackPendingBRL / btcPrice * 1e8);
          acc.satsFromCashback = num(acc.satsFromCashback) + s;
          acc.cashbackPendingBRL -= s * btcPrice / 1e8;
        }
      }
      acc.lockedInstallments = round2(Math.min(num(acc.lockedInstallments), num(acc.collateralTotal)));
      acc.limitAvailable = round2(num(acc.collateralTotal) - num(acc.lockedInstallments));
      break;
    }
    default:
      break;
  }
}

/** Registra um lançamento (+/−). Datas futuras ficam agendadas e entram na Onda. */
export function addLedgerEntry(state, input, { today, btcPrice } = {}) {
  const changes = emptyChanges();
  const acc = state.accounts.find((a) => a.id === input.accountId);
  const entry = {
    id: uid('tx'),
    profileId: input.profileId,
    date: input.date || today,
    direction: input.direction === 'in' ? 'in' : 'out',
    amount: round2(Math.abs(num(input.amount))),
    accountId: input.accountId || null,
    impactCashToday: acc ? isRealLiquidity(acc) : false,
    category: input.category || (input.direction === 'in' ? 'entrada' : 'gasto'),
    note: input.note || '',
    installments: cardInstallments(acc, input.installments),
    obligationId: input.obligationId || null,
    ...(input.tower ? { tower: input.tower } : {}),
    ...(input.fee ? { fee: input.fee, feeKind: input.feeKind, feeNote: input.feeNote } : {}),
    status: (input.date || today) > today ? 'scheduled' : 'posted',
    createdAt: new Date().toISOString(),
  };
  changes.ledger.push(entry);
  if (entry.status === 'posted') applyEffects(state, entry, changes, { btcPrice });
  return { changes, entry };
}

/** Posta lançamentos agendados cuja data chegou. */
export function processScheduled(state, today, opts = {}) {
  const changes = emptyChanges();
  const due = state.ledger.filter((e) => e.status === 'scheduled' && !e.forecast && e.date <= today);
  for (const e of due) {
    const posted = { ...e, status: 'posted' };
    upsert(changes.ledger, posted);
    applyEffects(state, posted, changes, opts);
  }
  return changes;
}

/** Desfaz um lançamento, estornando o efeito sobre a conta. */
export function removeLedgerEntry(state, entryId) {
  const changes = emptyChanges();
  changes.removeLedger = [entryId];
  const e = state.ledger.find((x) => x.id === entryId);
  if (!e || e.status === 'scheduled' || !e.accountId) return changes;
  const accRef = state.accounts.find((a) => a.id === e.accountId);
  if (!accRef) return changes;
  const acc = clone(accRef);
  const amount = num(e.amount);
  const sign = e.direction === 'in' ? 1 : -1;
  if (acc.type === 'checking_cash' || acc.type === 'benefit_card' || acc.type === 'savings_pot') {
    acc.balance = round2(num(acc.balance) - sign * amount);
  } else if (acc.type === 'credit_card') {
    const back = e.direction === 'out' ? 1 : -1; // desfazer compra devolve limite e tira da fatura; desfazer estorno o contrário
    const inst = e.direction === 'out' ? state.obligations.find((o) => o.sourceEntryId === e.id) : null;
    if (inst) {
      // compra parcelada: devolve só o que ainda não foi pago (o resto do limite já voltou parcela a parcela)
      acc.limitAvailable = round2(Math.min(num(acc.limitTotal), num(acc.limitAvailable) + num(inst.balance)));
      changes.removeObligations.push(inst.id);
    } else {
      acc.limitAvailable = round2(Math.max(0, Math.min(num(acc.limitTotal), num(acc.limitAvailable) + back * amount)));
      const debt = state.obligations.find((o) => o.type === 'card_debt' && o.accountId === acc.id && o.status !== 'paid' && !o.installmentAmount);
      if (debt) {
        const d = clone(debt);
        d.balance = round2(Math.max(0, num(d.balance) - back * amount));
        d.principalAmount = round2(Math.max(0, num(d.principalAmount) - back * amount));
        d.totalAmount = d.balance;
        changes.obligations.push(d);
      }
    }
  } else if (acc.type === 'collateralized_yield_crypto') {
    if (e.direction === 'in') acc.collateralTotal = round2(num(acc.collateralTotal) - amount);
    else if (num(e.installments) > 1) {
      const inst = state.obligations.find((o) => o.sourceEntryId === e.id);
      acc.lockedInstallments = round2(Math.max(0, num(acc.lockedInstallments) - (inst ? num(inst.balance) : amount)));
      if (inst) changes.removeObligations.push(inst.id);
    } else acc.collateralTotal = round2(num(acc.collateralTotal) + amount);
    acc.limitAvailable = round2(num(acc.collateralTotal) - num(acc.lockedInstallments));
  }
  changes.accounts.push(acc);
  return changes;
}

/**
 * Paga (total ou parcialmente) uma obrigação.
 * @param {object} p { obligationId, profileId, amount, accountId?, date, settle?: boolean }
 *   settle = quitação com desconto: o valor pago encerra a dívida inteira.
 */
export function payObligation(state, p, { today, btcPrice } = {}) {
  const changes = emptyChanges();
  const members = memberIds(state);
  const original = state.obligations.find((o) => o.id === p.obligationId);
  if (!original) throw new Error('Obrigação não encontrada.');
  const ob = clone(original);
  const date = p.date || today;
  const paid = round2(Math.abs(num(p.amount)));
  const fee = round2(Math.max(0, num(p.fee))); // pago a mais (juros, multa, taxa): não abate a dívida
  const open = openFor(ob, p.profileId, members);
  const settle = Boolean(p.settle);
  const reduction = settle ? open : round2(Math.min(open, paid));
  const fullForProfile = reduction >= open - 0.01;
  const discount = settle ? round2(Math.max(0, open - paid)) : 0;

  if (ob.isShared) {
    ob.paidShares = { ...(ob.paidShares || {}) };
    ob.paidShares[p.profileId] = round2(num(ob.paidShares[p.profileId]) + reduction);
  } else {
    ob.balance = round2(Math.max(0, num(ob.balance) - reduction));
  }

  // parcelamento (qualquer tipo): cada parcela coberta avança a contagem, o vencimento
  // e, em boleto/carnê, o prazo do cartório — a próxima parcela tem o próprio risco de protesto
  const inst = num(ob.installmentAmount);
  let coveredInstallment = false;
  if (inst > 0 && !ob.isShared) {
    coveredInstallment = reduction >= inst - 0.01;
    if (settle || ob.balance <= 0.01) {
      if (ob.installmentsLeft != null) ob.installmentsLeft = 0;
    } else {
      const covered = Math.floor((reduction + 0.01) / inst);
      if (covered > 0) {
        if (ob.installmentsLeft != null) ob.installmentsLeft = Math.max(1, num(ob.installmentsLeft) - covered);
        if (ob.dueDate) ob.dueDate = addMonths(ob.dueDate, covered);
        if (ob.rules?.protestDeadline) ob.rules = { ...ob.rules, protestDeadline: addMonths(ob.rules.protestDeadline, covered) };
      }
    }
  }

  if (fee > 0) {
    ob.feesPaid = round2(num(ob.feesPaid) + fee);
    ob.feeLog = [...(ob.feeLog || []), { id: uid('fee'), date, amount: fee, base: paid, kind: p.feeKind || 'outro', note: String(p.feeNote || '').slice(0, 120) }];
  }

  if (ob.type === 'card_debt' && ob.accountId) {
    const accRef = state.accounts.find((a) => a.id === ob.accountId);
    if (accRef) {
      const acc = clone(accRef);
      if (acc.type === 'collateralized_yield_crypto') {
        // cada parcela paga libera a garantia que estava travada
        acc.lockedInstallments = round2(Math.max(0, num(acc.lockedInstallments) - reduction));
        acc.limitAvailable = round2(num(acc.collateralTotal) - num(acc.lockedInstallments));
      } else if (acc.limitShrinking) {
        // o banco corta o limite na mesma proporção do pagamento: limite não volta
        acc.limitTotal = round2(Math.max(num(acc.limitAvailable), num(acc.limitTotal) - reduction));
        acc.limitHistory = [...(acc.limitHistory || []), { date, limitTotal: acc.limitTotal }];
      } else {
        acc.limitAvailable = round2(Math.min(num(acc.limitTotal), num(acc.limitAvailable) + reduction));
      }
      changes.accounts.push(acc);
    }
  }

  const everyonePaid = ob.isShared
    ? members.every((pid) => num(ob.paidShares?.[pid]) >= shareAmount(ob, pid, members) - 0.01)
    : ob.balance <= 0.01;
  if (everyonePaid) {
    ob.status = 'paid';
    ob.paidAt = date;
    if (ob.recurrence === 'monthly' && ob.dueDate) {
      const next = clone(original);
      next.id = uid('obl');
      next.dueDate = addMonths(original.dueDate, 1);
      next.balance = num(original.totalAmount) || num(original.principalAmount);
      next.principalAmount = next.balance;
      next.paidShares = {};
      next.feesPaid = ob.feesPaid; next.feeLog = ob.feeLog; // juros pagos seguem somando de um mês para o outro
      next.status = 'open';
      next.protestRescued = false;
      if (next.rules?.protestDeadline) next.rules = { ...next.rules, protestDeadline: addMonths(original.rules.protestDeadline, 1) };
      next.createdAt = date;
      changes.obligations.push(next);
    }
  }

  // Dano bloqueado → horas de vida
  const rescue = rescueBreakdown(original, paid, date, { fullPayment: fullForProfile || coveredInstallment, discount });
  const advanced = ob.dueDate !== original.dueDate;
  if (rescue.parts.some((x) => x.kind === 'protest')) ob.protestRescued = !advanced;
  else if (advanced) ob.protestRescued = false;
  upsert(changes.obligations, ob);

  if (p.accountId && paid + fee > 0) {
    const { changes: c2 } = addLedgerEntry(
      { ...state, accounts: state.accounts.map((a) => changes.accounts.find((x) => x.id === a.id) || a) },
      { profileId: p.profileId, direction: 'out', amount: round2(paid + fee), accountId: p.accountId, date, category: 'pagamento', note: original.beneficiary, obligationId: original.id, fee: fee || undefined, feeKind: fee ? (p.feeKind || 'outro') : undefined, feeNote: fee ? p.feeNote || '' : undefined },
      { today, btcPrice },
    );
    changes.ledger.push(...c2.ledger);
    for (const a of c2.accounts) upsert(changes.accounts, a);
  }

  const profile = state.profiles.find((x) => x.id === p.profileId);
  let minutes = 0;
  if (profile && rescue.total > 0) {
    const rate = realHourlyRate(profile);
    minutes = moneyToMinutes(rescue.total, rate);
    const pr = clone(profile);
    pr.rescuedLifeMinutes = round2(num(pr.rescuedLifeMinutes) + minutes);
    pr.rescueLog = [{ id: uid('rsc'), date, obligationId: original.id, label: original.beneficiary, amount: rescue.total, minutes: round2(minutes), parts: rescue.parts }, ...(pr.rescueLog || [])].slice(0, 200);
    changes.profiles.push(pr);
  }

  return { changes, rescue: { ...rescue, minutes }, fullyPaid: everyonePaid, fullForProfile };
}

/** Dias até a próxima ocorrência relevante (para contadores). */
export function countdown(item, today) {
  const target = item.ob.rules?.canProtest && item.ob.rules?.protestDeadline && !item.ob.protested
    ? item.ob.rules.protestDeadline : item.ob.dueDate;
  return target ? diffDays(today, target) : null;
}
