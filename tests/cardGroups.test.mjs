import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCards, groupSim } from '../js/engines/cardGroups.js';

const T = '2026-11-21';
const it = (id, ob, extra = {}) => ({ id, ob: { beneficiary: id, ...ob }, updated: 100, principalPart: 100, riskLayer: 0, bleed: 0, riskParts: {}, late: 0, alerts: [], installment: null, ...extra });
const fatura = () => it('f', { type: 'card_debt', accountId: 'a', dueDate: '2026-12-17' }, { updated: 3880, principalPart: 3880 });
const inst = (id, tower, due = '2026-12-17') => it(id, { type: 'card_debt', accountId: 'a', installmentAmount: 120, installmentsLeft: 10, tower, dueDate: due }, {
  updated: 1200, principalPart: 1200, installment: { amount: 120, total: 10, left: 10, paid: 0 },
});

test('modo normal: a torre do cartão é a fatura do mês (à vista + 1 parcela de cada compra)', () => {
  const [emp, g] = groupCards([it('emp', { type: 'personal_debt' }), fatura(), inst('c1', 'fatura'), inst('c2', 'separada')], [{ id: 'a', name: 'Nubank' }], { today: T });
  assert.equal(emp.id, 'emp');
  assert.equal(g.group.length, 3);
  assert.equal(g.updated, 3880 + 120 + 120);
  assert.equal(g.principalPart, 4120);
  assert.equal(g.future, 2 * 1080);
  assert.equal(g.owedAll, 3880 + 2400);
});

test('agrupado: "em cima" põe todas as parcelas na torre do cartão; "separada" vira torre própria', () => {
  const out = groupCards([fatura(), inst('c1', 'fatura'), inst('c2', 'separada')], [], { grouped: true, today: T });
  assert.equal(out.length, 2);
  const g = out.find((x) => x.group);
  assert.equal(g.principalPart, 3880 + 1200);
  assert.equal(out.find((x) => x.id === 'c2').group, undefined);
});

test('sem fatura à vista: uma compra sozinha no modo normal mostra só a parcela do mês', () => {
  const [g] = groupCards([inst('c1', 'fatura')], [{ id: 'a', name: 'Nubank' }], { today: T });
  assert.equal(g.ob.beneficiary, 'Fatura Nubank');
  assert.equal(g.updated, 120);
  // agrupado, a compra sozinha volta a ser a torre com todas as parcelas
  const [x] = groupCards([inst('c1', 'fatura')], [], { grouped: true, today: T });
  assert.equal(x.id, 'c1');
  assert.equal(x.group, undefined);
});

test('simulação: entram as parcelas que vencem até o fim do período', () => {
  const nov = groupCards([fatura(), inst('c1', 'fatura')], [], { horizon: 1, today: T })[0];
  assert.equal(nov.id, 'f'); // parcela só vence em dezembro: em novembro a torre é só a fatura
  const tres = groupCards([fatura(), inst('c1', 'fatura')], [], { horizon: 3, today: T })[0];
  assert.equal(tres.updated, 3880 + 240); // dez e jan
  const per = new Map([['f', { paid: 3880, left: 0, done: true, doneAt: '2026-12-01' }], ['c1', { paid: 240, left: 960, done: false }]]);
  const s = groupSim(tres, per, '2027-01-01');
  assert.equal(s.left, 0);
  assert.equal(s.done, true);
});
