import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/core/model.js';
import { addLedgerEntry, removeLedgerEntry, payObligation } from '../js/engines/cashflow.js';

const T = '2026-11-21';
const mk = () => normalizeState({
  household: {}, profiles: [{ id: 'p', name: 'R' }],
  accounts: [
    { id: 'pix', profileId: 'p', name: 'Pix', type: 'checking_cash', balance: 1000 },
    { id: 'nu', profileId: 'p', name: 'Nubank', type: 'credit_card', limitTotal: 2000, limitAvailable: 1700, closingDay: 10, dueDay: 17 },
  ], obligations: [], ledger: [],
});
const apply = (s, c) => {
  for (const k of ['accounts', 'obligations', 'ledger']) for (const r of c[k] || []) { const i = s[k].findIndex((x) => x.id === r.id); if (i >= 0) s[k][i] = r; else s[k].push(r); }
  for (const id of c.removeLedger || []) s.ledger = s.ledger.filter((e) => e.id !== id);
  for (const id of c.removeObligations || []) s.obligations = s.obligations.filter((o) => o.id !== id);
};

test('compra no crédito: gasta limite, aumenta a fatura, define vencimento; estorno e desfazer', () => {
  const s = mk();
  const r = addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 100, accountId: 'nu', category: 'mercado', date: T }, { today: T });
  apply(s, r.changes);
  assert.equal(s.accounts[1].limitAvailable, 1600);
  const debt = s.obligations[0];
  assert.equal(debt.balance, 100);
  assert.equal(debt.dueDate, '2026-12-17'); // depois do fechamento (dia 10) → fatura de dezembro
  assert.equal(s.accounts[0].balance, 1000); // não mexe no Pix
  const e = addLedgerEntry(s, { profileId: 'p', direction: 'in', amount: 30, accountId: 'nu', category: 'estorno', date: T }, { today: T });
  apply(s, e.changes);
  assert.equal(s.accounts[1].limitAvailable, 1630);
  assert.equal(s.obligations[0].balance, 70);
  apply(s, removeLedgerEntry(s, e.entry.id));
  assert.equal(s.obligations[0].balance, 100);
  apply(s, removeLedgerEntry(s, r.entry.id));
  assert.equal(s.accounts[1].limitAvailable, 1700);
  assert.equal(s.obligations[0].balance, 0);
});

test('pagar a fatura devolve o limite', () => {
  const s = mk();
  apply(s, addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 100, accountId: 'nu', category: 'x', date: T }, { today: T }).changes);
  apply(s, payObligation(s, { obligationId: s.obligations[0].id, profileId: 'p', amount: 100, accountId: 'pix', date: T }, { today: T }).changes);
  assert.equal(s.accounts[1].limitAvailable, 1700);
  assert.equal(s.accounts[0].balance, 900);
  assert.equal(s.obligations[0].status, 'paid');
});

test('compra parcelada em 3x no cartão comum: limite todo usado, 3 parcelas, cada pagamento devolve limite', () => {
  const s = mk();
  const r = addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 300, accountId: 'nu', category: 'compras', note: 'Celular', installments: 3, date: T }, { today: T });
  apply(s, r.changes);
  assert.equal(s.accounts[1].limitAvailable, 1400);
  assert.equal(s.obligations.length, 1);
  const d = s.obligations[0];
  assert.equal(d.installmentAmount, 100);
  assert.equal(d.installmentsLeft, 3);
  assert.equal(d.dueDate, '2026-12-17');
  // uma compra à vista continua indo para a fatura, separada da parcelada
  apply(s, addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 40, accountId: 'nu', category: 'x', date: T }, { today: T }).changes);
  assert.equal(s.obligations.length, 2);
  const pay = payObligation(s, { obligationId: d.id, profileId: 'p', amount: 100, accountId: 'pix', date: T }, { today: T });
  apply(s, pay.changes);
  const d2 = s.obligations.find((o) => o.id === d.id);
  assert.equal(d2.installmentsLeft, 2);
  assert.equal(d2.dueDate, '2027-01-17');
  assert.equal(s.accounts[1].limitAvailable, 1460);
  // desfazer a compra devolve só o que ainda estava em aberto e some com a dívida
  apply(s, removeLedgerEntry(s, r.entry.id));
  assert.equal(s.obligations.some((o) => o.id === d.id), false);
  assert.equal(s.accounts[1].limitAvailable, 1660); // 1460 + 200 ainda em aberto
});

test('cartão que não parcela ignora as parcelas', () => {
  const s = mk();
  s.accounts[1].noInstallments = true;
  const r = addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 300, accountId: 'nu', category: 'x', installments: 3, date: T }, { today: T });
  apply(s, r.changes);
  assert.equal(s.obligations.length, 1);
  assert.equal(s.obligations[0].installmentAmount, undefined);
  assert.equal(s.obligations[0].balance, 300);
});

test('cartão com garantia parcelado: dívida em N parcelas; pagar libera a garantia travada', () => {
  const s = normalizeState({
    household: {}, profiles: [{ id: 'p', name: 'R' }],
    accounts: [
      { id: 'pix', profileId: 'p', name: 'Pix', type: 'checking_cash', balance: 1000 },
      { id: 'bp', profileId: 'p', name: 'Bipa', type: 'collateralized_yield_crypto', collateralTotal: 1000, lockedInstallments: 0, closingDay: 5, dueDay: 10 },
    ], obligations: [], ledger: [],
  });
  const r = addLedgerEntry(s, { profileId: 'p', direction: 'out', amount: 300, accountId: 'bp', category: 'x', installments: 3, date: T }, { today: T, btcPrice: 400000 });
  apply(s, r.changes);
  assert.equal(s.accounts[1].lockedInstallments, 300);
  assert.equal(s.accounts[1].limitAvailable, 700);
  assert.equal(s.obligations[0].installmentsLeft, 3);
  apply(s, payObligation(s, { obligationId: s.obligations[0].id, profileId: 'p', amount: 100, accountId: 'pix', date: T }, { today: T }).changes);
  assert.equal(s.accounts[1].lockedInstallments, 200);
  assert.equal(s.accounts[1].limitAvailable, 800);
});

test('pagou a mais: juros ficam registrados e somam de um mês para o outro', () => {
  const s = mk();
  s.obligations.push({ id: 'o1', profileId: 'p', type: 'boleto', beneficiary: 'Internet', balance: 100, totalAmount: 100, principalAmount: 100, recurrence: 'monthly', dueDate: '2026-11-10', status: 'open' });
  const r = payObligation(s, { obligationId: 'o1', profileId: 'p', amount: 100, fee: 7.5, feeKind: 'juros', feeNote: 'atraso 5 dias', accountId: 'pix', date: T }, { today: T });
  apply(s, r.changes);
  assert.equal(s.accounts[0].balance, 892.5);
  const paid = s.obligations.find((o) => o.id === 'o1');
  assert.equal(paid.status, 'paid');
  assert.equal(paid.feesPaid, 7.5);
  const next = s.obligations.find((o) => o.id !== 'o1');
  assert.equal(next.feesPaid, 7.5);
  assert.equal(next.balance, 100);
  assert.equal(s.ledger[0].fee, 7.5);
  const r2 = payObligation(s, { obligationId: next.id, profileId: 'p', amount: 100, fee: 2, feeKind: 'multa', accountId: 'pix', date: T }, { today: T });
  apply(s, r2.changes);
  assert.equal(s.obligations.find((o) => o.id === next.id).feesPaid, 9.5);
});
