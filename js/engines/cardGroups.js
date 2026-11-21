// Agrupa, na tela das torres, a fatura de um cartão com as compras parceladas que a pessoa quis ver
// "dentro" dela. Só muda a APRESENTAÇÃO: cada compra continua sendo uma dívida própria (parcelas,
// vencimento e devolução de limite), e a simulação e os pagamentos seguem olhando uma a uma.

import { round2 } from '../core/util.js';

const fullValue = (i) => (i.installment?.total >= 2 ? Math.max(i.principalPart, i.installment.amount * i.installment.total) : i.principalPart);

/**
 * @param items itens da triagem (tri.battlefield)
 * @param accounts contas do perfil
 * @returns lista para desenhar: itens normais e, no lugar da fatura do cartão, um item-grupo `{ group, ... }`
 */
export function groupCards(items, accounts = []) {
  const slots = [];
  const groups = new Map();
  for (const i of items) {
    const ob = i.ob;
    const card = ob.type === 'card_debt' && ob.accountId;
    const child = card && ob.installmentAmount && ob.tower !== 'separada';
    const head = card && !ob.installmentAmount;
    if (!child && !head) { slots.push(i); continue; }
    let g = groups.get(ob.accountId);
    if (!g) { g = []; groups.set(ob.accountId, g); slots.push(g); }
    g.push(i);
  }
  return slots.map((s) => {
    if (!Array.isArray(s)) return s;
    if (s.length === 1) return s[0];
    const head = s.find((i) => !i.ob.installmentAmount) || null;
    const children = s.filter((i) => i.ob.installmentAmount);
    const base = head || children[0];
    const acc = accounts.find((a) => a.id === base.ob.accountId);
    const sum = (f) => round2(s.reduce((t, i) => t + (f(i) || 0), 0));
    return {
      ...base,
      id: base.id,
      group: [...(head ? [head] : []), ...children],
      accountId: base.ob.accountId,
      ob: { ...base.ob, beneficiary: head ? head.ob.beneficiary : `Cartão ${acc?.name || ''}`.trim() },
      installment: null,
      updated: sum((i) => i.updated),
      principalPart: sum(fullValue),
      riskLayer: sum((i) => i.riskLayer),
      bleed: sum((i) => i.bleed),
      riskParts: { accrued: sum((i) => i.riskParts?.accrued), protestRisk: sum((i) => i.riskParts?.protestRisk) },
      late: Math.max(...s.map((i) => i.late || 0)),
      dueSoon: s.some((i) => i.dueSoon),
      daysToDue: Math.min(...s.map((i) => (i.daysToDue ?? 9999))),
      quickWin: false,
      alerts: s.flatMap((i) => i.alerts || []),
    };
  });
}

export { fullValue };
