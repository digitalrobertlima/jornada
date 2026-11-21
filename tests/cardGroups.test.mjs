import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCards } from '../js/engines/cardGroups.js';

const it = (id, ob, extra = {}) => ({ id, ob: { beneficiary: id, ...ob }, updated: 100, principalPart: 100, riskLayer: 0, bleed: 0, riskParts: {}, late: 0, alerts: [], installment: null, ...extra });
const inst = (id, tower) => it(id, { type: 'card_debt', accountId: 'a', installmentAmount: 120, tower }, { updated: 1200, principalPart: 1200, installment: { amount: 120, total: 12, left: 12, paid: 0 } });

test('compra parcelada "na torre do cartão" vira uma torre só: fatura + parcelas', () => {
  const fatura = it('f', { type: 'card_debt', accountId: 'a' }, { updated: 3880, principalPart: 3880 });
  const [emp, g] = groupCards([it('emp', { type: 'personal_debt' }), fatura, inst('c1', 'fatura')], [{ id: 'a', name: 'Nubank' }]);
  assert.equal(emp.id, 'emp');
  assert.equal(g.group.length, 2);
  assert.equal(g.updated, 5080);
  assert.equal(g.principalPart, 3880 + 1440); // parcelada usa o valor cheio (12 × 120)
  assert.equal(g.installment, null);
});

test('"torre só dela" não entra no grupo e a fatura mantém o tamanho', () => {
  const fatura = it('f', { type: 'card_debt', accountId: 'a' }, { updated: 3880, principalPart: 3880 });
  const out = groupCards([fatura, inst('c1', 'separada')]);
  assert.equal(out.length, 2);
  assert.equal(out[0].updated, 3880);
  assert.equal(out[0].group, undefined);
});

test('sem fatura aberta: duas compras agrupadas formam a torre do cartão; uma sozinha fica como está', () => {
  const g = groupCards([inst('c1', 'fatura'), inst('c2', 'fatura')], [{ id: 'a', name: 'Nubank' }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].ob.beneficiary, 'Cartão Nubank');
  assert.equal(groupCards([inst('c1', 'fatura')]).length, 1);
  assert.equal(groupCards([inst('c1', 'fatura')])[0].group, undefined);
});
