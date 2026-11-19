// Matriz de Triagem em 3 Zonas ("Névoa de Guerra").
//  Zona 1 — Linha de Frente: vitais + boletos protestáveis
//  Zona 2 — Campo de Batalha: Quick Wins (pessoas) + Bola de Neve (menor saldo)
//  Zona 3 — Domo de Quarentena: dívidas antigas estouradas por juros compostos

import { diffDays } from '../core/dates.js';
import { VITAL_KINDS, installmentInfo } from '../core/model.js';
import { num, round2 } from '../core/util.js';
import { overdueAmount, monthlyBleed } from './lifeHours.js';

export const QUARANTINE_LATE_DAYS = 90;
export const QUARANTINE_MULTIPLIER = 1.5;

/** Perfis que participam da casa (todos os perfis do aparelho). */
export function memberIds(state) {
  return state.profiles.map((p) => p.id);
}

/** Cota de um perfil numa obrigação compartilhada (R$ por ciclo). */
export function shareAmount(ob, profileId, members) {
  const total = num(ob.totalAmount || ob.balance);
  if (!ob.isShared) return ob.profileId === profileId ? total : 0;
  if (!members.includes(profileId)) return 0;
  if (ob.shareMode === 'ratio' && ob.splitRatio) {
    const totalRatio = members.reduce((s, id) => s + num(ob.splitRatio[id]), 0);
    return totalRatio > 0 ? round2(total * num(ob.splitRatio[profileId]) / totalRatio) : 0;
  }
  if (ob.shareMode === 'fixed' && ob.fixedShare) {
    if (ob.fixedShare[profileId] != null) return round2(ob.fixedShare[profileId]);
    const fixedIds = members.filter((id) => ob.fixedShare[id] != null);
    const rest = total - fixedIds.reduce((s, id) => s + num(ob.fixedShare[id]), 0);
    const others = members.length - fixedIds.length;
    return others > 0 ? round2(Math.max(0, rest) / others) : 0;
  }
  return round2(total / members.length);
}

/** Quanto este perfil ainda deve nesta obrigação (sem encargos de atraso). */
export function openFor(ob, profileId, members) {
  if (ob.status === 'paid') return 0;
  if (ob.isShared) {
    const share = shareAmount(ob, profileId, members);
    const paid = num(ob.paidShares?.[profileId]);
    return round2(Math.max(0, share - paid));
  }
  if (ob.profileId !== profileId) return 0;
  return round2(Math.max(0, num(ob.balance)));
}

export function isVisibleTo(ob, profileId, members) {
  return ob.profileId === profileId || (ob.isShared && shareAmount(ob, profileId, members) > 0);
}

export function classify(ob, today) {
  const rules = ob.rules || {};
  if (ob.zone) return { zone: ob.zone, reason: 'Zona definida por você' };
  const late = ob.dueDate ? diffDays(ob.dueDate, today) : 0;
  const principal = num(ob.principalAmount);
  const multiplier = principal > 0 ? num(ob.balance) / principal : 1;

  if (ob.isLegacy || ob.type === 'legacy_debt') {
    return { zone: 'quarantine', reason: multiplier >= 1.2 ? `Juros compostos: ${multiplier.toFixed(1).replace('.', ',')}× o valor original` : 'Dívida antiga selada' };
  }
  if (ob.type === 'vital_fixed' || ob.isWorkTool) {
    return { zone: 'frontline', reason: `Conta vital · ${VITAL_KINDS[ob.vitalKind] || (ob.isWorkTool ? 'Ferramenta de trabalho' : 'Essencial')}` };
  }
  if (rules.canProtest && !ob.protested) {
    if (!rules.protestDeadline || rules.protestDeadline >= today) {
      const d = rules.protestDeadline ? diffDays(today, rules.protestDeadline) : null;
      return { zone: 'frontline', reason: d === null ? 'Pode ir a protesto' : d === 0 ? 'Cartório: prazo final HOJE' : `Cartório em ${d} dia${d === 1 ? '' : 's'}` };
    }
    return { zone: 'frontline', reason: 'Prazo do cartório passou — risco de protesto a qualquer momento', urgent: true };
  }
  if (late > QUARANTINE_LATE_DAYS && multiplier >= QUARANTINE_MULTIPLIER) {
    return { zone: 'quarantine', reason: `Juros compostos: ${multiplier.toFixed(1).replace('.', ',')}× o valor original` };
  }
  if (late > QUARANTINE_LATE_DAYS * 2) {
    return { zone: 'quarantine', reason: `Atrasada há ${late} dias` };
  }
  if (ob.type === 'personal_debt' || ob.bucket === 'familia') {
    return { zone: 'battlefield', reason: 'Quick Win · alívio imediato', quickWin: true };
  }
  if (ob.type === 'card_debt') return { zone: 'battlefield', reason: 'Cartão ativo · Bola de Neve' };
  if (ob.protested) return { zone: 'battlefield', reason: 'Já protestado — quitar remove do cartório' };
  return { zone: 'battlefield', reason: 'Bola de Neve' };
}

/** Item de triagem com todas as métricas que a interface precisa. */
export function buildItem(ob, profileId, ctx) {
  const open = openFor(ob, profileId, ctx.members);
  if (open <= 0.004) return null;
  const { today } = ctx;
  const rules = ob.rules || {};
  const cls = classify(ob, today);
  const daysToDue = ob.dueDate ? diffDays(today, ob.dueDate) : null;
  const daysToProtest = rules.canProtest && rules.protestDeadline && !ob.protested
    ? diffDays(today, rules.protestDeadline) : null;
  const late = daysToDue !== null && daysToDue < 0 ? -daysToDue : 0;
  const hasPenaltyRules = num(rules.finePercent) > 0 || num(rules.dailyInterestPercent) > 0;
  const updated = late > 0 && hasPenaltyRules ? overdueAmount(open, rules, late) : open;

  const fraction = ob.isShared ? open / Math.max(0.01, num(ob.totalAmount)) : 1;
  const principalPart = round2(Math.min(open, num(ob.principalAmount) * (ob.isShared ? fraction : 1) || open));
  const accrued = round2(Math.max(0, updated - principalPart));
  const protestRisk = rules.canProtest && !ob.protested && !ob.protestRescued ? num(rules.estimatedProtestFee) : 0;
  const bleed = monthlyBleed({ ...ob, balance: open }, today);

  // dívida parcelada (qualquer tipo): o que vence agora é a parcela, não o saldo inteiro
  const installment = ob.isShared ? null : installmentInfo(ob);
  const dueNow = installment ? round2(Math.min(installment.amount, updated)) : updated;

  const account = ob.accountId ? ctx.accountsById?.get(ob.accountId) : null;
  const alerts = [];
  if (account?.type === 'credit_card' && account.limitShrinking) {
    alerts.push({
      kind: 'limitShrinking',
      text: 'Corte de limite ativo: pagar este cartão NÃO devolve limite. Nunca tire dinheiro de conta vital para pagar o mínimo dele.',
    });
  }
  if (cls.urgent) alerts.push({ kind: 'protest', text: cls.reason });

  const urgencyCandidates = [daysToDue, daysToProtest].filter((d) => d !== null);
  const urgencyDays = urgencyCandidates.length ? Math.min(...urgencyCandidates) : 999;

  return {
    id: ob.id,
    ob,
    zone: cls.zone,
    reason: cls.reason,
    quickWin: Boolean(cls.quickWin),
    open,
    updated,
    dueNow,
    principalPart,
    riskLayer: round2(accrued + protestRisk + bleed),
    riskParts: { accrued, protestRisk, bleed },
    bleed,
    daysToDue,
    daysToProtest,
    late,
    urgencyDays,
    alerts,
    installment,
    dueSoon: daysToDue !== null && daysToDue >= 0 && daysToDue <= 3,
    isVital: ob.type === 'vital_fixed' || ob.isWorkTool,
    isProtestable: Boolean(rules.canProtest && !ob.protested),
  };
}

/**
 * Triagem completa de um perfil.
 * @returns {{frontline: object[], battlefield: object[], quarantine: object[], target: object|null}}
 */
export function triage(state, profileId, today) {
  const ctx = {
    today,
    members: memberIds(state),
    accountsById: new Map(state.accounts.map((a) => [a.id, a])),
  };
  const result = { frontline: [], battlefield: [], quarantine: [], target: null };
  for (const ob of state.obligations) {
    if (!isVisibleTo(ob, profileId, ctx.members)) continue;
    const item = buildItem(ob, profileId, ctx);
    if (item) result[item.zone].push(item);
  }
  result.frontline.sort((a, b) => (b.late > 0) - (a.late > 0) || a.urgencyDays - b.urgencyDays || b.updated - a.updated);
  result.battlefield.sort((a, b) => (b.quickWin - a.quickWin) || a.updated - b.updated);
  result.quarantine.sort((a, b) => a.updated - b.updated);
  result.target = result.frontline[0] || result.battlefield[0] || result.quarantine[0] || null;
  return result;
}

export function zoneTotal(items) {
  return round2(items.reduce((s, i) => s + i.updated, 0));
}
