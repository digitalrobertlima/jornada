import test from 'node:test';
import assert from 'node:assert/strict';
import { userState, TODAY } from './helpers/userLike.mjs';
import { triage } from '../js/engines/triage.js';
import { waterline, realLiquidity } from '../js/engines/cashflow.js';
import { planDistribution, essentialsCoverage, scheduledToMonthly, pendingForecasts } from '../js/engines/forecast.js';
import { buildGuide } from '../js/engines/guide.js';
import { projectFreedom } from '../js/engines/freedom.js';

const derive = (s) => {
  const tri = triage(s, 'p', TODAY);
  return { tri, wl: waterline(s, 'p', TODAY, tri), cash: realLiquidity(s, 'p'), eras: { shield: { target: 500 } }, rate: 6, pid: 'p', today: TODAY, profile: s.profiles[0] };
};

test('essenciais: o que vai entrar antes do vencimento conta (não manda pegar empréstimo à toa)', () => {
  const s = userState();
  const d = derive(s);
  const cov = essentialsCoverage(s, 'p', TODAY, d.wl, d.cash);
  assert.equal(cov.shortfall, 0);
  const g = buildGuide(d, { state: s });
  assert.equal(g[0].id, 'waterline-covered');
  assert.ok(!g.some((x) => x.id === 'waterline'));
});

test('plano: lançamento agendado em conta Pix (vale-transporte) entra na data', () => {
  const s = userState();
  const p = planDistribution(s, 'p', TODAY, triage(s, 'p', TODAY));
  const dez7 = p.moments.find((m) => m.date === '2026-12-07');
  assert.equal(dez7.income, 2500);
  assert.match(dez7.label, /Vale-transporte/);
});

test('entrada agendada que parece fixa: guia pergunta se cai todo mês; converter vira previsão mensal', () => {
  const s = userState();
  const g = buildGuide(derive(s), { state: s });
  const step = g.find((x) => x.id === 'recurring-s1');
  assert.ok(step);
  const ch = scheduledToMonthly(s, 's1');
  s.ledger[s.ledger.findIndex((e) => e.id === 's1')] = ch.ledger[0];
  const fc = pendingForecasts(s, 'p').find((e) => e.id === 's1');
  assert.equal(fc.repeat, 'monthly');
  assert.equal(fc.kind, 'vale_transporte');
  assert.equal(fc.liquidity, 'pix');
  // a projeção passa a contar com ele todo mês
  const proj = projectFreedom(s, 'p', TODAY, triage(s, 'p', TODAY));
  assert.ok(proj.monthlyIncome >= 2500);
  assert.ok(proj.months !== null);
});

test('simulação: fatura do cartão é paga no mês em que vence, antes de adiantar outras dívidas', async () => {
  const { atHorizon } = await import('../js/engines/freedom.js');
  const s = userState();
  s.ledger[s.ledger.findIndex((e) => e.id === 's1')] = scheduledToMonthly(s, 's1').ledger[0];
  const proj = projectFreedom(s, 'p', TODAY, triage(s, 'p', TODAY));
  const dez = atHorizon(proj, 2);
  assert.equal(dez.per.get('fat').done, true);
  assert.equal(dez.per.get('pb').paid, 90); // só a parcela do mês, sem adiantar antes da fatura
});

test('assistente: "gastei 300 no roxo em 3x" vai para o cartão parcelado; "do azul" sai do Pix, não do cofrinho', async () => {
  const { createTools, runTool } = await import('../js/agent/tools.js');
  const { memApi } = await import('./helpers/memapi.mjs');
  const { parseBasic } = await import('../js/agent/basic.js');
  const s = userState();
  const tools = createTools(memApi(s, 'p', TODAY));
  const q = parseBasic('gastei 300 no roxo em 3x', TODAY);
  const r = await runTool(tools, q.tool, q.args);
  assert.match(r.preview.lines.join(' '), /Banco Roxo/);
  assert.match(r.preview.lines.join(' '), /3x de R\$\s?100,00/);
  await r.execute();
  const debt = s.obligations.find((o) => o.accountId === 'roxo' && o.installmentsTotal === 3);
  assert.ok(debt);
  assert.equal(s.accounts.find((a) => a.id === 'pix').balance, 230);
  // "gastei 50 no mercado" não vai para o cartão Mercado Facil
  const m = parseBasic('gastei 50 no mercado', TODAY);
  const r2 = await runTool(tools, m.tool, m.args);
  assert.match(r2.preview.lines.join(' '), /Banco Azul - Conta/);
  const mv = parseBasic('passa 50 do azul pro cofrinho', TODAY);
  const r3 = await runTool(tools, mv.tool, mv.args);
  assert.equal(r3.preview.title, 'Mover saldo');
  assert.match(r3.preview.lines[0], /Banco Azul - Conta.*COFRINHO AZUL/);
});

test('assistente: pagar a conta atrasada não assusta quando o que vai entrar cobre as essenciais', async () => {
  const { createTools, runTool } = await import('../js/agent/tools.js');
  const { memApi } = await import('./helpers/memapi.mjs');
  const s = userState();
  const r = await runTool(createTools(memApi(s, 'p', TODAY)), 'pagar', { conta: 'internet' });
  assert.equal(r.preview.warn, null);
});
