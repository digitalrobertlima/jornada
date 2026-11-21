// Mover saldo entre as próprias contas: conta Pix ↔ cofrinho ↔ garantia (limite) do cartão.
// Não é entrada nem gasto: o dinheiro só muda de lugar. Nada vai para o fluxo diário;
// tudo entra no histórico de ações, então dá para desfazer.

import { num, round2 } from '../core/util.js';
import { normalizeAccount } from '../core/model.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** O que dá para tirar desta conta agora. Vale travado nunca sai; limite de crédito comum não é saldo. */
export function movableFrom(acc) {
  if (!acc) return 0;
  switch (acc.type) {
    case 'checking_cash':
    case 'savings_pot':
      return Math.max(0, round2(num(acc.balance)));
    case 'collateralized_yield_crypto':
      return Math.max(0, round2(num(acc.limitAvailable)));
    default:
      return 0;
  }
}

export const canSend = (acc) => movableFrom(acc) > 0 || acc?.type === 'checking_cash' || acc?.type === 'savings_pot' || acc?.type === 'collateralized_yield_crypto';
export const canReceive = (acc) => ['checking_cash', 'savings_pot', 'collateralized_yield_crypto'].includes(acc?.type);

/** Contas do perfil que entram numa movimentação, em ordem útil (Pix primeiro). */
export function transferAccounts(state, pid) {
  const rank = { checking_cash: 0, collateralized_yield_crypto: 1, savings_pot: 2 };
  return state.accounts.filter((a) => a.profileId === pid && canReceive(a)).sort((a, b) => rank[a.type] - rank[b.type]);
}

const WORD = {
  checking_cash: (a) => `saldo em Pix de ${a.name}`,
  savings_pot: (a) => `cofrinho ${a.name}`,
  collateralized_yield_crypto: (a) => `limite do cartão ${a.name}`,
};
export const placeName = (a) => (WORD[a?.type] ? WORD[a.type](a) : a?.name || 'conta');

/**
 * Calcula a movimentação. Devolve { changes, from, to, amount, lines } ou lança Error em português.
 * `changes.accounts` traz as duas contas já atualizadas.
 */
export function moveMoney(state, { fromId, toId, amount }) {
  const A = state.accounts.find((a) => a.id === fromId);
  const B = state.accounts.find((a) => a.id === toId);
  const value = round2(amount);
  if (!A || !B) throw new Error('Escolha de onde sai e para onde vai.');
  if (A.id === B.id) throw new Error('Escolha duas contas diferentes.');
  if (A.profileId !== B.profileId) throw new Error('As duas contas precisam ser do mesmo perfil.');
  if (!(value > 0)) throw new Error('Quanto você quer mover?');
  if (A.type === 'benefit_card') throw new Error(`${A.name} é saldo de vale: ele fica travado e não sai para outra conta.`);
  if (!canSend(A)) throw new Error(`Não dá para tirar dinheiro de ${A.name} assim.`);
  if (!canReceive(B)) throw new Error(`${B.name} não recebe dinheiro movido de outra conta.`);
  const avail = movableFrom(A);
  if (value > avail + 0.004) {
    throw new Error(A.type === 'collateralized_yield_crypto'
      ? `O limite livre de ${A.name} é ${fmt(avail)}${num(A.lockedInstallments) > 0 ? ` (o resto está travado em parcelas)` : ''}.`
      : `${A.name} tem só ${fmt(avail)}.`);
  }
  const a = clone(A);
  const b = clone(B);
  if (a.type === 'collateralized_yield_crypto') a.collateralTotal = round2(num(a.collateralTotal) - value);
  else a.balance = round2(num(a.balance) - value);
  if (b.type === 'collateralized_yield_crypto') b.collateralTotal = round2(num(b.collateralTotal) + value);
  else b.balance = round2(num(b.balance) + value);
  const A2 = normalizeAccount(a);
  const B2 = normalizeAccount(b);
  return { changes: { accounts: [A2, B2] }, from: A2, to: B2, before: { from: A, to: B }, amount: value };
}

const fmt = (v) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** Valor mostrado em cada conta (saldo ou limite livre). */
export function shownValue(acc) {
  return acc?.type === 'collateralized_yield_crypto' ? num(acc.limitAvailable) : num(acc?.balance);
}
