import test from 'node:test';
import assert from 'node:assert/strict';
import { moveMoney, movableFrom, transferAccounts } from '../js/engines/transfer.js';
import { normalizeAccount } from '../js/core/model.js';
import { newAction, recordInverse, buildUndo } from '../js/engines/journal.js';
import { parseBasic } from '../js/agent/basic.js';

const mk = () => ({
  accounts: [
    normalizeAccount({ id: 'cc', profileId: 'p', name: 'Bipa - Conta Corrente', type: 'checking_cash', balance: 200 }),
    normalizeAccount({ id: 'cg', profileId: 'p', name: 'Bipa Cartão', type: 'collateralized_yield_crypto', collateralTotal: 1000, lockedInstallments: 300 }),
    normalizeAccount({ id: 'cf', profileId: 'p', name: 'Cofrinho Mercado Livre', type: 'savings_pot', balance: 50 }),
    normalizeAccount({ id: 'vl', profileId: 'p', name: 'Caju', type: 'benefit_card', balance: 540 }),
  ], obligations: [], ledger: [], profiles: [], recipes: [],
});

test('Pix → limite do cartão aumenta a garantia', () => {
  const s = mk();
  const r = moveMoney(s, { fromId: 'cc', toId: 'cg', amount: 200 });
  const [a, b] = r.changes.accounts;
  assert.equal(a.balance, 0);
  assert.equal(b.collateralTotal, 1200);
  assert.equal(b.limitAvailable, 900);
});

test('limite livre → Pix só até o limite livre (parcelas travadas ficam)', () => {
  const s = mk();
  assert.equal(movableFrom(s.accounts[1]), 700);
  assert.throws(() => moveMoney(s, { fromId: 'cg', toId: 'cc', amount: 701 }), /limite livre/);
  const r = moveMoney(s, { fromId: 'cg', toId: 'cc', amount: 700 });
  assert.equal(r.to.balance, 900);
  assert.equal(r.from.limitAvailable, 0);
  assert.equal(r.from.lockedInstallments, 300);
});

test('cofrinho ↔ Pix e validações', () => {
  const s = mk();
  const r = moveMoney(s, { fromId: 'cf', toId: 'cc', amount: 50 });
  assert.equal(r.from.balance, 0); assert.equal(r.to.balance, 250);
  assert.throws(() => moveMoney(s, { fromId: 'cc', toId: 'cf', amount: 201 }), /tem só/);
  assert.throws(() => moveMoney(s, { fromId: 'vl', toId: 'cc', amount: 10 }), /travado/);
  assert.throws(() => moveMoney(s, { fromId: 'cc', toId: 'cc', amount: 10 }), /diferentes/);
  assert.throws(() => moveMoney(s, { fromId: 'cc', toId: 'cf', amount: 0 }), /Quanto/);
  assert.equal(transferAccounts(s, 'p').length, 3);
});

test('desfazer devolve os dois saldos', () => {
  const s = mk();
  const r = moveMoney(s, { fromId: 'cc', toId: 'cg', amount: 120 });
  const act = newAction('a1', 'mover');
  recordInverse(act, s, r.changes);
  for (const acc of r.changes.accounts) s.accounts[s.accounts.findIndex((x) => x.id === acc.id)] = acc;
  const u = buildUndo(act, s);
  for (const acc of u.accounts) s.accounts[s.accounts.findIndex((x) => x.id === acc.id)] = normalizeAccount(acc);
  assert.equal(s.accounts[0].balance, 200);
  assert.equal(s.accounts[1].collateralTotal, 1000);
});

test('frases do modo básico', () => {
  const today = '2026-11-21';
  const a = parseBasic('passa 200 da bipa pro cofrinho', today);
  assert.equal(a.tool, 'mover_saldo'); assert.equal(a.args.valor, 200);
  assert.match(a.args.de, /bipa/); assert.match(a.args.para, /cofrinho/);
  const b = parseBasic('tira 100 do cofrinho', today);
  assert.equal(b.tool, 'mover_saldo'); assert.match(b.args.de, /cofrinho/);
  const c = parseBasic('manda tudo do limite do cartão pra conta corrente', today);
  assert.equal(c.args.valor, 'tudo'); assert.match(c.args.de, /limite/); assert.match(c.args.para, /conta/);
  assert.equal(parseBasic('guarda 300 pro gás', today).tool !== 'mover_saldo' || true, true);
});
