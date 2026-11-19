import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { normalizeState } from '../js/core/model.js';
import { realLiquidity } from '../js/engines/cashflow.js';
import { createTools, runTool, toolsPrompt } from '../js/agent/tools.js';
import { memApi } from './helpers/memapi.mjs';

const TODAY = '2026-11-19';
function setup(pid = 'prof_01') {
  const state = normalizeState(buildDemoScenario(TODAY));
  const api = memApi(state, pid, TODAY);
  return { state, api, tools: createTools(api) };
}

test('catálogo: todas as ferramentas têm descrição e o prompt cabe', () => {
  const { tools } = setup();
  for (const t of Object.values(tools)) {
    assert.ok(t.desc.length > 10, t.name);
    assert.ok(['read', 'write', 'ui'].includes(t.kind), t.name);
  }
  assert.ok(toolsPrompt(tools).length < 6000);
});

test('leitura: situação traz números dos motores', async () => {
  const { tools } = setup();
  const r = await runTool(tools, 'situacao');
  assert.match(r.text, /Dinheiro livre \(conta\/Pix\): R\$\s?1\.180,00/);
  assert.match(r.text, /essenciais/);
  assert.match(r.text, /Próxima entrada prevista: Adiantamento/);
});

test('leitura: contas a pagar e plano', async () => {
  const { tools } = setup();
  const c = await runTool(tools, 'contas_a_pagar', {});
  assert.match(c.text, /Aluguel Casa/);
  const p = await runTool(tools, 'plano');
  assert.match(p.text, /Hoje/);
  assert.match(p.text, /Adiantamento/);
});

test('"caiu 840 do adiantamento" confirma a previsão (não cria entrada duplicada)', async () => {
  const { tools, state, api } = setup();
  const r = await runTool(tools, 'registrar_entrada', { valor: '840', descricao: 'adiantamento' });
  assert.equal(r.preview.title, 'Confirmar que caiu');
  const before = state.ledger.length;
  const done = await r.execute();
  assert.match(done.text, /840/);
  assert.equal(realLiquidity(state, 'prof_01'), 1180 + 840);
  assert.ok(state.ledger.length <= before + 1); // só a próxima do mês (repete)
  assert.equal(api.journal()[0].label, 'Caiu: Adiantamento (R$ 840,00)');
});

test('entrada sem descrição casa com previsão de mesmo valor', async () => {
  const { tools } = setup();
  const r = await runTool(tools, 'registrar_entrada', { valor: 840 });
  assert.equal(r.preview.title, 'Confirmar que caiu');
});

test('entrada avulsa (bico) vai para a conta livre', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'registrar_entrada', { valor: 'R$ 150', descricao: 'bico de entrega' });
  assert.equal(r.preview.title, 'Registrar entrada');
  await r.execute();
  assert.equal(realLiquidity(state, 'prof_01'), 1180 + 150);
  assert.equal(state.ledger.at(-1).category, 'extra');
});

test('gasto categoriza e avisa quando aperta as essenciais', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'registrar_gasto', { valor: 45, descricao: 'uber' });
  assert.match(r.preview.lines[0], /transporte/);
  assert.match(r.preview.warn, /essenciais/);
  await r.execute();
  assert.equal(realLiquidity(state, 'prof_01'), 1180 - 45);
});

test('pagar: nome aproximado, parcela padrão e alerta de prioridade', async () => {
  const { tools } = setup();
  const amb = await runTool(tools, 'pagar', { conta: 'aluguel' });
  assert.ok(amb.error.startsWith('Qual conta?'));
  assert.ok(amb.options.length >= 2);
  const r = await runTool(tools, 'pagar', { conta: 'empréstimo do banco' });
  assert.ok(r.preview, r.error);
  assert.match(r.preview.lines[0], /Empréstimo pessoal/);
  assert.match(r.preview.warn || '', /essenciais/); // não-essencial com déficit
  const luz = await runTool(tools, 'pagar', { conta: 'luz' });
  assert.equal(luz.preview.warn, null);
});

test('pagar e desfazer devolvem tudo como era', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'pagar', { conta: 'conta de luz' });
  await r.execute();
  assert.ok(realLiquidity(state, 'prof_01') < 1180);
  const u = await runTool(tools, 'desfazer');
  assert.match(u.preview.lines[0], /Conta de luz/);
  await u.execute();
  assert.equal(realLiquidity(state, 'prof_01'), 1180);
});

test('prever entrada: vale-alimentação fica travado; datas faladas', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'prever_entrada', { tipo: 'vale alimentação', valor: '600', data: 'dia 5' });
  assert.match(r.preview.lines[1], /Travado/);
  await r.execute();
  const e = state.ledger.at(-1);
  assert.equal(e.liquidity, 'locked');
  assert.equal(e.date, '2026-12-05');
  assert.equal(e.repeat, 'monthly');
  const bad = await runTool(tools, 'prever_entrada', { tipo: 'salario', valor: 100 });
  assert.match(bad.error, /dia/);
});

test('cadastrar dívida parcelada e conta essencial', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'cadastrar_divida', { tipo: 'emprestimo', nome: 'Mercado Pago', parcela: '150', parcelas: '6', vencimento: '10/12' });
  assert.match(r.preview.lines[1], /6x de R\$\s?150,00/);
  await r.execute();
  const ob = state.obligations.at(-1);
  assert.equal(ob.type, 'financing');
  assert.equal(ob.balance, 900);
  const v = await runTool(tools, 'cadastrar_divida', { nome: 'Internet', valor: 99.9, vencimento: 'dia 15' });
  await v.execute();
  assert.equal(state.obligations.at(-1).type, 'vital_fixed');
  assert.equal(state.obligations.at(-1).recurrence, 'monthly');
});

test('criar peça: regra cria o pote junto e passa a separar dinheiro', async () => {
  const { tools, state } = setup();
  const r = await runTool(tools, 'criar_peca', { peca: 'regra', pote: 'Ração', quando: 'bico', valor: 30 });
  assert.ok(r.preview, r.error);
  assert.ok(r.preview.lines.some((l) => l.includes('Cria também o pote')));
  await r.execute();
  assert.equal(state.recipes.length, 2);
  const e = await runTool(tools, 'registrar_entrada', { valor: 200, descricao: 'bico' });
  await e.execute();
  assert.equal(state.recipes.find((x) => x.piece === 'pote').state.guardado, 30);
});

test('criar peça inválida explica o problema', async () => {
  const { tools } = setup();
  const r = await runTool(tools, 'criar_peca', { peca: 'painel', titulo: 'X', formula: 'total / salario' });
  assert.match(r.error, /salario/);
  const t = await runTool(tools, 'criar_peca', { peca: 'foguete' });
  assert.match(t.error, /Que tipo de peça/);
});

test('calcular é seguro', async () => {
  const { tools } = setup();
  assert.match((await runTool(tools, 'calcular', { expressao: '1250 - 840' })).text, /= 410/);
  assert.ok((await runTool(tools, 'calcular', { expressao: 'fetch("x")' })).error);
});

test('pedido de função fica anotado', async () => {
  const { tools, api } = setup();
  const r = await runTool(tools, 'pedir_funcao', { descricao: 'ler extrato do banco por foto' });
  await r.execute();
  assert.deepEqual(api.requests, ['ler extrato do banco por foto']);
});

test('ferramenta desconhecida e argumentos com nomes em inglês', async () => {
  const { tools } = setup();
  assert.match((await runTool(tools, 'hackear')).error, /Não existe/);
  const r = await runTool(tools, 'registrar_gasto', { amount: 10, description: 'pão' });
  assert.ok(r.preview);
});
