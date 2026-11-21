// Torre do cartão na tela de dívidas. Só muda a APRESENTAÇÃO: cada compra parcelada continua sendo
// uma dívida própria (parcelas, vencimento, devolução de limite); pagamentos e simulação olham uma a uma.
//
// - Normal ("por mês"): a torre do cartão é a FATURA DO MÊS = compras à vista + a parcela atual de
//   cada compra parcelada. As outras parcelas ficam cada uma no seu mês (não aparecem empilhadas).
// - Agrupado (botão "Agrupar parcelas"): cada compra mostra todas as parcelas juntas — em cima da
//   torre do cartão (tower: 'fatura') ou numa torre só dela (tower: 'separada').
// - Simulação: entram as parcelas que vencem até o fim do período escolhido.

import { num, round2 } from '../core/util.js';
import { addMonths } from '../core/dates.js';

const fullValue = (i) => (i.installment?.total >= 2 ? Math.max(i.principalPart, i.installment.amount * i.installment.total) : i.principalPart);
const monthIdx = (today, iso) => (Number(iso.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(iso.slice(5, 7)) - Number(today.slice(5, 7));

export const isCardChild = (i) => i.ob.type === 'card_debt' && Boolean(i.ob.accountId) && num(i.ob.installmentAmount) > 0;
const isCardHead = (i) => i.ob.type === 'card_debt' && Boolean(i.ob.accountId) && !(num(i.ob.installmentAmount) > 0);

/**
 * Quantas parcelas de uma compra entram na torre agora.
 * part: 'full' (todas, agrupado) | número de parcelas (por mês / simulação)
 */
function partFor(child, { grouped, horizon, today }) {
  if (grouped && child.ob.tower !== 'separada') return 'full';
  const left = num(child.installment?.left ?? child.ob.installmentsLeft) || 1;
  if (horizon == null) return 1;
  // simulação: as parcelas que vencem até o fim do período (h = 1 → só este mês)
  const first = child.ob.dueDate ? Math.max(0, monthIdx(today, child.ob.dueDate)) : 0;
  return Math.max(0, Math.min(left, horizon - first));
}

/**
 * @param items itens da triagem (tri.battlefield)
 * @param accounts contas do perfil
 * @param opts { grouped: boolean, horizon: number|null (meses da simulação), today }
 * @returns lista para desenhar: itens normais e, no lugar da fatura do cartão, um item-grupo `{ group, ... }`
 */
export function groupCards(items, accounts = [], { grouped = false, horizon = null, today = '' } = {}) {
  const slots = [];
  const groups = new Map();
  for (const i of items) {
    const child = isCardChild(i);
    // agrupado + "torre só dela": a compra fica com a torre própria (todas as parcelas)
    if (child && grouped && i.ob.tower === 'separada') { slots.push(i); continue; }
    if (!child && !isCardHead(i)) { slots.push(i); continue; }
    let g = groups.get(i.ob.accountId);
    if (!g) { g = []; groups.set(i.ob.accountId, g); slots.push(g); }
    g.push(i);
  }
  const out = [];
  for (const s of slots) {
    if (!Array.isArray(s)) { out.push(s); continue; }
    const head = s.find(isCardHead) || null;
    const children = s.filter(isCardChild);
    // agrupado e só uma coisa na torre: desenha como sempre (a compra com todas as parcelas, ou só a fatura)
    if (s.length === 1 && (head || grouped)) { out.push(s[0]); continue; }
    const members = [
      ...(head ? [{ item: head, part: 'head', value: head.principalPart, owed: head.updated }] : []),
      ...children.map((c) => {
        const part = partFor(c, { grouped, horizon, today });
        const inst = num(c.installment?.amount || c.ob.installmentAmount);
        if (part === 'full') return { item: c, part, value: fullValue(c), owed: c.updated, blocks: c.installment?.total || 1 };
        const owed = round2(Math.min(c.updated, inst * part));
        return { item: c, part: 'month', value: owed, owed, blocks: part, inst };
      }).filter((m) => m.part === 'full' || m.blocks > 0),
    ];
    if (!members.length) continue;
    const base = head || children[0];
    const acc = accounts.find((a) => a.id === base.ob.accountId);
    const sum = (f) => round2(members.reduce((t, m) => t + (f(m) || 0), 0));
    const owedAll = round2(s.reduce((t, i) => t + i.updated, 0));
    const thisInvoice = sum((m) => m.owed);
    const nextDue = members.map((m) => m.item.ob.dueDate).filter(Boolean).sort()[0] || base.ob.dueDate || null;
    out.push({
      ...base,
      id: base.id,
      group: members,
      grouped,
      accountId: base.ob.accountId,
      ob: { ...base.ob, beneficiary: head ? head.ob.beneficiary : `Fatura ${acc?.name || 'do cartão'}`, dueDate: nextDue },
      installment: null,
      updated: thisInvoice,
      owedAll,
      future: round2(Math.max(0, owedAll - thisInvoice)),
      principalPart: sum((m) => m.value),
      riskLayer: head ? head.riskLayer : 0,
      bleed: round2(s.reduce((t, i) => t + (i.bleed || 0), 0)),
      riskParts: head ? head.riskParts : { accrued: 0, protestRisk: 0, bleed: 0 },
      late: Math.max(...s.map((i) => i.late || 0)),
      dueSoon: s.some((i) => i.dueSoon),
      daysToDue: Math.min(...s.map((i) => (i.daysToDue ?? 9999))),
      quickWin: false,
      alerts: s.flatMap((i) => i.alerts || []),
    });
  }
  return out;
}

/** Simulação de um grupo: soma o que o período paga em cada parte (só as parcelas que entram na torre). */
export function groupSim(g, per, endDate) {
  let paid = 0;
  let left = 0;
  let last = null;
  for (const m of g.group) {
    const x = per.get(m.item.id) || { paid: 0, left: m.item.updated, done: false };
    if (m.part === 'month') {
      const p = Math.min(x.paid, m.owed);
      paid += p;
      left += Math.max(0, m.owed - p);
      if (m.owed - p <= 0.004 && x.paid > 0) last = !last || (x.doneAt || endDate) > last ? (x.doneAt || endDate) : last;
    } else {
      paid += x.paid;
      left += x.left;
      if (x.done) last = !last || x.doneAt > last ? x.doneAt : last;
    }
  }
  const done = left <= 0.004;
  return { paid: round2(paid), left: round2(left), done, doneAt: done ? last || endDate : null, until: endDate };
}

export { fullValue, monthIdx };
// usado pela tela do grupo: o mês de cada parcela
export const installmentMonths = (child, n = 12) => {
  const left = Math.min(n, num(child.installment?.left ?? child.ob.installmentsLeft) || 0);
  return Array.from({ length: left }, (_, k) => (child.ob.dueDate ? addMonths(child.ob.dueDate, k) : null));
};
