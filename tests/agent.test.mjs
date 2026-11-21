import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { normalizeState } from '../js/core/model.js';
import { createTools, runTool } from '../js/agent/tools.js';
import { parseBasic } from '../js/agent/basic.js';
import { parseAction, agentTurn, buildSystemPrompt, looksLikeAction, cleanReply } from '../js/agent/protocol.js';
import { memApi } from './helpers/memapi.mjs';

const TODAY = '2026-11-19';
const setup = () => {
  const state = normalizeState(buildDemoScenario(TODAY));
  const api = memApi(state, 'prof_01', TODAY);
  return { state, api, tools: createTools(api) };
};

test('modo básico: frases do dia a dia viram a ferramenta certa', () => {
  const cases = [
    ['caiu 840 do adiantamento', 'registrar_entrada', { valor: 840 }],
    ['recebi 150 de bico', 'registrar_entrada', { valor: 150 }],
    ['paguei a luz', 'pagar', {}],
    ['paguei 300 do cartão', 'pagar', { valor: 300 }],
    ['gastei 30 no uber', 'registrar_gasto', { valor: 30 }],
    ['vai cair 1600 de salário dia 5', 'prever_entrada', { valor: 1600, data: '2026-12-05' }],
    ['devo 200 pra minha mãe', 'cadastrar_divida', { tipo: 'pessoa', valor: 200 }],
    ['cria um pote de 300 pro gás', 'criar_peca', { peca: 'pote', meta: 300 }],
    ['me lembra de ligar pro banco sexta', 'criar_peca', { peca: 'lembrete', data: '2026-11-20' }],
    ['sempre que cair o adiantamento separa 50 pro pote da ração', 'criar_peca', { peca: 'regra', valor: 50 }],
    ['quanto gastei de uber esse mês?', 'lancamentos', { tipo: 'gastos' }],
    ['como estou?', 'situacao', {}],
    ['o que eu faço agora?', 'o_que_fazer', {}],
    ['como distribuir o salário?', 'plano', {}],
    ['quanto eu devo?', 'contas_a_pagar', {}],
    ['desfaz', 'desfazer', {}],
  ];
  for (const [phrase, tool, args] of cases) {
    const r = parseBasic(phrase, TODAY);
    assert.equal(r.tool, tool, phrase);
    for (const [k, v] of Object.entries(args)) assert.equal(r.args[k], v, `${phrase} → ${k}`);
  }
  assert.ok(parseBasic('blablabla', TODAY).reply);
});

test('modo básico de ponta a ponta: frases rodam nas ferramentas', async () => {
  const { tools } = setup();
  const run = async (p) => { const r = parseBasic(p, TODAY); return runTool(tools, r.tool, r.args); };
  assert.equal((await run('caiu 840 do adiantamento')).preview.title, 'Confirmar que caiu');
  assert.match((await run('paguei a luz')).preview.lines[0], /Conta de luz/);
  assert.match((await run('me lembra de ligar pro banco sexta')).preview.lines[0], /Ligar pro banco|ligar pro banco/i);
  const pote = await run('cria um pote de 300 pro gás até dia 10');
  assert.ok(pote.preview, pote.error);
  assert.match(pote.preview.lines[0], /Pote "gas"|Pote "gás"/i);
  const regra = await run('sempre que cair o adiantamento separa 50 pro pote da ração');
  assert.ok(regra.preview, regra.error);
  const gasto = await run('quanto gastei de combustivel?');
  assert.match(gasto.text, /combustivel/);
});

test('protocolo: lê o pedido de ferramenta em vários formatos', () => {
  assert.deepEqual(parseAction('<acao>{"ferramenta": "pagar", "args": {"conta": "luz"}}</acao>'), { tool: 'pagar', args: { conta: 'luz' } });
  assert.deepEqual(parseAction('```json\n{"ferramenta":"situacao","args":{}}\n```'), { tool: 'situacao', args: {} });
  assert.deepEqual(parseAction("<ação>{ferramenta: 'pagar', args: {conta: 'luz',}}</ação>"), { tool: 'pagar', args: { conta: 'luz' } });
  assert.deepEqual(parseAction('call:situacao{}'), { tool: 'situacao', args: {} });
  assert.deepEqual(parseAction('Vou ver. <acao>{"tool":"plano","arguments":{}}</acao>'), { tool: 'plano', args: {} });
  assert.equal(parseAction('Você tem R$ 1.180,00 livres.'), null);
  assert.ok(looksLikeAction('  <acao>{"fer'));
  assert.ok(!looksLikeAction('Você tem'));
  assert.equal(cleanReply('Oi!<end_of_turn>'), 'Oi!');
});

test('prompt do sistema cabe no contexto do celular', () => {
  const { tools } = setup();
  const p = buildSystemPrompt(tools, { userName: 'Ana' });
  assert.ok(p.length < 9000, `prompt com ${p.length} caracteres`);
  assert.match(p, /registrar_entrada/);
});

function fakeLLM(script) {
  const sent = [];
  return {
    sent,
    async *send(msg) {
      sent.push(msg);
      const out = script.shift() ?? 'ok';
      for (const piece of out.match(/.{1,7}/gs)) yield piece;
    },
  };
}

test('turno: leitura → resposta usa os dados da ferramenta', async () => {
  const { tools } = setup();
  const llm = fakeLLM(['<acao>{"ferramenta":"situacao","args":{}}</acao>', 'Você tem R$ 1.180,00 livres, mas faltam R$ 645,40 para as essenciais.']);
  const events = [];
  const r = await agentTurn({ llm, tools, message: 'como estou?', onEvent: (e) => events.push(e) });
  assert.match(r.reply, /1\.180/);
  assert.ok(events.some((e) => e.type === 'tool' && e.tool === 'situacao'));
  assert.match(llm.sent[1], /<resultado ferramenta="situacao">/);
  assert.match(llm.sent[1], /Dinheiro livre/);
});

test('turno: escrita para na prévia (nada é gravado sem confirmar)', async () => {
  const { tools, state } = setup();
  const before = JSON.stringify(state.ledger);
  const llm = fakeLLM(['<acao>{"ferramenta":"registrar_gasto","args":{"valor":30,"descricao":"uber"}}</acao>']);
  const events = [];
  await agentTurn({ llm, tools, message: 'gastei 30 de uber', onEvent: (e) => events.push(e) });
  const prev = events.find((e) => e.type === 'preview');
  assert.ok(prev);
  assert.equal(JSON.stringify(state.ledger), before);
  await prev.result.execute();
  assert.notEqual(JSON.stringify(state.ledger), before);
});

test('turno: ambiguidade vira pergunta com opções', async () => {
  const { tools } = setup();
  const llm = fakeLLM(['<acao>{"ferramenta":"pagar","args":{"conta":"aluguel"}}</acao>']);
  const events = [];
  await agentTurn({ llm, tools, message: 'paguei o aluguel', onEvent: (e) => events.push(e) });
  const ask = events.find((e) => e.type === 'ask');
  assert.ok(ask.options.length >= 2);
});

test('turno: limite de passos evita laço infinito', async () => {
  const { tools } = setup();
  const loop = Array(10).fill('<acao>{"ferramenta":"situacao","args":{}}</acao>');
  const llm = fakeLLM(loop);
  const r = await agentTurn({ llm, tools, message: 'x', onEvent: () => {} });
  assert.ok(r.reply);
  assert.equal(llm.sent.length, 4);
});

import { grounded } from '../js/agent/protocol.js';

test('trava: a IA não muda dados sem a pessoa pedir nem inventa valores', () => {
  assert.equal(grounded('registrar_entrada', { valor: 29.4, descricao: 'Livre hoje' }, 'O que faço agora?'), false);
  assert.equal(grounded('registrar_entrada', { valor: 29.4 }, 'Olá'), false);
  assert.equal(grounded('registrar_gasto', { valor: 30, descricao: 'uber' }, 'gastei 30 de uber'), true);
  assert.equal(grounded('registrar_entrada', { valor: 840 }, 'caiu meu adiantamento'), false);
  assert.equal(grounded('registrar_entrada', { descricao: 'adiantamento' }, 'caiu meu adiantamento'), true);
  assert.equal(grounded('prever_entrada', { valor: 2500 }, 'vai cair 2,5 mil dia 5'), true);
  assert.equal(grounded('pagar', { conta: 'luz' }, 'paguei a luz'), true);
});

test('turno: ação inventada é recusada e vira resposta normal', async () => {
  const { tools, state } = setup();
  const before = JSON.stringify(state.ledger);
  const llm = fakeLLM(['<acao>{"ferramenta":"registrar_entrada","args":{"valor":29.4,"descricao":"Livre hoje"}}</acao>', 'Oi! Como posso ajudar?']);
  const events = [];
  const r = await agentTurn({ llm, tools, message: '[Hoje: qui]\nOlá', userText: 'Olá', onEvent: (e) => events.push(e) });
  assert.equal(r.reply, 'Oi! Como posso ajudar?');
  assert.ok(!events.some((e) => e.type === 'preview'));
  assert.match(llm.sent[1], /Recusado/);
  assert.equal(JSON.stringify(state.ledger), before);
});
