import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { triage } from '../js/engines/triage.js';
import { waterline, realLiquidity, liquidityBreakdown } from '../js/engines/cashflow.js';
import { evaluateEras } from '../js/engines/eraMachine.js';
import { realHourlyRate } from '../js/engines/lifeHours.js';
import { buildGuide } from '../js/engines/guide.js';

const TODAY = '2026-11-19';
function derive(s, pid) {
  const profile = s.profiles.find((p) => p.id === pid);
  const tri = triage(s, pid, TODAY);
  const wl = waterline(s, pid, TODAY, tri);
  const cash = realLiquidity(s, pid);
  const eras = evaluateEras({ tri, wl, cash, shieldTarget: profile.shieldTarget, sats: 0, baselines: {} });
  return { profile, tri, wl, cash, liq: liquidityBreakdown(s, pid), eras, rate: realHourlyRate(profile), today: TODAY, pid };
}

test('guia: cartório vem primeiro', () => {
  const s = buildDemoScenario(TODAY);
  const g = buildGuide(derive(s, 'prof_02'), { state: s });
  assert.equal(g[0].id, 'protest-obl_boleto_01');
  assert.equal(g[0].tone, 'urgent');
  assert.equal(g[0].actions[0].act, 'script');
});

test('guia: sem cartório, falta para as essenciais vira o próximo passo, com opções', () => {
  const s = buildDemoScenario(TODAY);
  const g = buildGuide(derive(s, 'prof_01'), { state: s });
  assert.equal(g[0].id, 'waterline');
  assert.match(g[0].why, /Melhores saídas/);
  assert.ok(g.some((x) => x.id === 'shrink-obl_cc_01'));
});

test('guia: com dinheiro sobrando sugere reserva e vitória rápida', () => {
  const s = buildDemoScenario(TODAY);
  s.accounts.find((a) => a.id === 'acc_bank_01').balance = 3000; // sobra 1.174,60 acima das essenciais
  let g = buildGuide(derive(s, 'prof_01'), { state: s });
  assert.ok(!g.some((x) => x.id === 'shield')); // reserva de 500 já coberta
  assert.ok(g.some((x) => x.id === 'quick-obl_leo_01'));
  s.accounts.find((a) => a.id === 'acc_bank_01').balance = 2100; // sobra 274,60
  g = buildGuide(derive(s, 'prof_01'), { state: s });
  assert.ok(g.some((x) => x.id === 'shield'));
  assert.ok(!g.some((x) => x.id.startsWith('quick-')));
});

test('guia: perfil vazio ensina a começar', () => {
  const s = buildDemoScenario(TODAY);
  s.obligations = [];
  const g = buildGuide(derive(s, 'prof_01'), { state: s });
  assert.equal(g[0].id, 'start-vital');
});

test('guia: conta já atrasada não vira "vence … mas o dinheiro só entra" (sem R$ 0,00 sem sentido)', async () => {
  const s = buildDemoScenario(TODAY);
  s.obligations.push({ id: 'obl_bmi', profileId: 'prof_01', type: 'boleto', bucket: 'pessoal', beneficiary: 'BMI TELECOM', principalAmount: 99, totalAmount: 99, balance: 99, dueDate: '2026-11-17', status: 'open', monthlyInterestPercent: 5, rules: {} });
  s.ledger.forEach((e) => { if (e.forecast) e.date = '2026-12-07'; });
  s.accounts.find((a) => a.id === 'acc_bank_01').balance = 0;
  const g = buildGuide(derive(s, 'prof_01'), { state: s });
  assert.ok(!g.some((x) => x.id === 'forecast-gap-obl_bmi'));
  assert.ok(!g.some((x) => /R\$\s?0,00 e faltam R\$\s?0,00/.test(x.why)));
});
