import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { triage } from '../js/engines/triage.js';
import { realLiquidity, processScheduled, liquidityWave } from '../js/engines/cashflow.js';
import { addForecast, confirmForecast, planDistribution, pendingForecasts } from '../js/engines/forecast.js';
import { normalizeLedger, normalizeAccount } from '../js/core/model.js';

const TODAY = '2026-11-19';
function apply(state, changes) {
  const s = structuredClone(state);
  for (const key of ['accounts', 'obligations', 'ledger', 'profiles']) {
    for (const rec of changes[key] || []) {
      const i = s[key].findIndex((r) => r.id === rec.id);
      if (i >= 0) s[key][i] = rec; else s[key].push(rec);
    }
  }
  if (changes.removeLedger) s.ledger = s.ledger.filter((e) => !changes.removeLedger.includes(e.id));
  return s;
}
const plan = (s, pid, opts) => planDistribution(s, pid, TODAY, triage(s, pid, TODAY), opts);

test('previsão não vira saldo sozinha quando a data chega', () => {
  const s = buildDemoScenario(TODAY);
  const s2 = apply(s, processScheduled(s, '2026-11-30'));
  assert.equal(realLiquidity(s2, 'prof_01'), realLiquidity(s, 'prof_01'));
  assert.ok(pendingForecasts(s2, 'prof_01').length >= 2);
});

test('previsão livre entra na onda de liquidez; travada não', () => {
  const s = buildDemoScenario(TODAY);
  const wave = liquidityWave(s, 'prof_01', TODAY);
  const last = wave[wave.length - 1];
  assert.equal(last.balance, realLiquidity(s, 'prof_01') + 840 + 1600); // a vale-alimentação (travada) fica de fora
});

test('addForecast: vale cria cartão travado e fica agendado', () => {
  const s = buildDemoScenario(TODAY);
  const { changes, entry } = addForecast(s, {
    profileId: 'prof_01', kind: 'vale_transporte', amount: 200, date: '2026-11-30',
    newAccount: { type: 'benefit_card', name: 'VT', balance: 0, lock: 'transporte' },
  }, { today: TODAY });
  assert.equal(entry.liquidity, 'locked');
  assert.equal(entry.impactCashToday, false);
  assert.equal(entry.status, 'scheduled');
  assert.equal(changes.accounts[0].type, 'benefit_card');
  assert.equal(entry.accountId, changes.accounts[0].id);
});

test('confirmForecast: soma no saldo certo e repete no mês seguinte', () => {
  const s = buildDemoScenario(TODAY);
  const { changes, entry } = addForecast(s, { profileId: 'prof_01', kind: 'salario', amount: 3000, date: '2026-11-30', accountId: 'acc_bank_01', repeat: 'monthly' }, { today: TODAY });
  const s1 = apply(s, changes);
  const r = confirmForecast(s1, entry.id, { amount: 2950, date: '2026-11-30', today: '2026-11-30' });
  const s2 = apply(s1, r.changes);
  assert.equal(realLiquidity(s2, 'prof_01'), realLiquidity(s, 'prof_01') + 2950);
  const posted = s2.ledger.find((e) => e.id === entry.id);
  assert.equal(posted.status, 'posted');
  assert.equal(posted.forecast, false);
  const next = pendingForecasts(s2, 'prof_01').find((e) => e.date === '2026-12-30');
  assert.ok(next, 'mês seguinte previsto');
  assert.equal(next.amount, 3000);
});

test('confirmForecast no cartão travado soma no saldo do vale, não no caixa', () => {
  const s = buildDemoScenario(TODAY);
  const e = s.ledger.find((x) => x.id === 'tx_d10b');
  const s2 = apply(s, confirmForecast(s, e.id, { amount: 450, date: TODAY, today: TODAY }).changes);
  assert.equal(s2.accounts.find((a) => a.id === 'acc_caju_01').balance, 320 + 450);
  assert.equal(realLiquidity(s2, 'prof_01'), realLiquidity(s, 'prof_01'));
});

test('plano: protege o aluguel antes de pagar a fatura e usa reserva', () => {
  const s = buildDemoScenario(TODAY);
  const p = plan(s, 'prof_01');
  const m0 = p.moments[0];
  assert.ok(!m0.lines.some((l) => l.name.includes('Fatura') && l.amount > 700), 'não gasta o dinheiro do aluguel na fatura');
  assert.ok(m0.held > 900, 'segura o que o aluguel precisa');
  const m1 = p.moments[1];
  assert.ok(m1.lines.some((l) => l.name.startsWith('Aluguel Casa') && l.amount === 1250));
});

test('plano: aponta conta que vence antes do dinheiro chegar', () => {
  const s = buildDemoScenario(TODAY);
  const p = plan(s, 'prof_02');
  assert.equal(p.verdict, 'short');
  const rent = p.gaps.find((g) => g.name.startsWith('Aluguel'));
  assert.ok(rent);
  assert.equal(rent.date, '2026-11-25');
  assert.equal(rent.resolvedAt, '2026-11-28');
  assert.equal(rent.have, 420);
});

test('plano: vale-alimentação paga conta de alimentação, Pix fica livre', () => {
  const s = buildDemoScenario(TODAY);
  s.obligations.push({
    id: 'obl_mercado', profileId: 'prof_01', type: 'vital_fixed', vitalKind: 'alimentacao', bucket: 'casa', beneficiary: 'Mercado do mês',
    principalAmount: 300, totalAmount: 300, balance: 300, dueDate: '2026-11-22', status: 'open', rules: {}, recurrence: null,
  });
  const p = plan(s, 'prof_01');
  const lines = p.moments[0].lines.filter((l) => l.name === 'Mercado do mês');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].paidWith, 'vale'); // 320 no Caju cobrem os 300
  assert.equal(lines[0].amount, 300);
});

test('plano: sem previsão cadastrada, avisa e não inventa dinheiro', () => {
  const s = buildDemoScenario(TODAY);
  s.ledger = s.ledger.filter((e) => !e.forecast);
  const p = plan(s, 'prof_01');
  assert.equal(p.hasForecast, false);
  assert.equal(p.incomeLiquid, 0);
});

test('normalizadores: liquidity, forecast e lock', () => {
  assert.equal(normalizeLedger({ id: 'x', direction: 'in', amount: 1, status: 'scheduled', forecast: true, liquidity: 'locked' }).liquidity, 'locked');
  assert.equal(normalizeLedger({ id: 'x', direction: 'out', amount: 1, status: 'scheduled', forecast: true }).forecast, false);
  assert.equal(normalizeAccount({ id: 'a', type: 'benefit_card', balance: 1 }).lock, 'alimentacao');
  assert.equal(normalizeAccount({ id: 'a', type: 'benefit_card', balance: 1, lock: 'transporte' }).lock, 'transporte');
});
