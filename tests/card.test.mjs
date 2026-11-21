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
