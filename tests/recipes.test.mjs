import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, variablesOf } from '../js/recipes/formula.js';
import {
  normalizeRecipe, validateRecipe, computePanel, dueReminders, applyRules, movePot, markReminderDone, customCategories,
} from '../js/recipes/model.js';
import { newAction, recordInverse, buildUndo } from '../js/engines/journal.js';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { normalizeState } from '../js/core/model.js';
import { norm, matchByName, parseMoneyBR, parseDateBR } from '../js/core/text.js';

const TODAY = '2026-11-19';
const demo = () => normalizeState(buildDemoScenario(TODAY));
function apply(state, changes) {
  const s = structuredClone(state);
  for (const key of ['accounts', 'obligations', 'ledger', 'profiles', 'recipes']) {
    for (const rec of changes[key] || []) {
      const i = s[key].findIndex((r) => r.id === rec.id);
      if (i >= 0) s[key][i] = rec; else s[key].push(rec);
    }
  }
  for (const [rk, key] of Object.entries({ removeLedger: 'ledger', removeRecipes: 'recipes', removeObligations: 'obligations', removeAccounts: 'accounts' })) {
    if (changes[rk]) s[key] = s[key].filter((e) => !changes[rk].includes(e.id));
  }
  return s;
}

test('fórmula: contas, precedência, pt-BR e funções', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('1.250,50 + 0,5'), 1251);
  assert.equal(evaluate('total / hora', { total: 300, hora: 15 }), 20);
  assert.equal(evaluate('arred(10 / 3, 2)'), 3.33);
  assert.equal(evaluate('max(1; 5; 2) - min(4; 2)'), 3);
  assert.equal(evaluate('max(1, 5)'), 5);
  assert.equal(evaluate('2,5 * 2'), 5);
  assert.equal(evaluate('50% * 200'), 100);
  assert.equal(evaluate('-3 + 5'), 2);
});

test('fórmula: recusa código e erros com mensagem clara', () => {
  assert.throws(() => evaluate('alert(1)'), /Função desconhecida/);
  assert.throws(() => evaluate('window.location'), /Símbolo não permitido|Não conheço/);
  assert.throws(() => evaluate('1 / 0'), /Divisão por zero/);
  assert.throws(() => evaluate('x + 1', { total: 1 }), /Não conheço "x"/);
  assert.throws(() => evaluate('2 +'), /incompleta/);
  assert.deepEqual(variablesOf('total / hora + arred(caixa)'), ['total', 'hora', 'caixa']);
});

test('texto: valores, datas e nomes aproximados', () => {
  assert.equal(parseMoneyBR('caiu 840 do adiantamento'), 840);
  assert.equal(parseMoneyBR('paguei R$ 1.250,00 do aluguel'), 1250);
  assert.equal(parseMoneyBR('vai cair 2,5 mil dia 5'), 2500);
  assert.equal(parseMoneyBR('dia 5 cai 1600'), 1600);
  assert.equal(parseMoneyBR('parcelado em 12x de 99,90'), 99.9);
  assert.equal(parseMoneyBR('nada aqui'), null);
  assert.equal(parseDateBR('amanhã', TODAY), '2026-11-20');
  assert.equal(parseDateBR('dia 5', TODAY), '2026-12-05');
  assert.equal(parseDateBR('dia 25', TODAY), '2026-11-25');
  assert.equal(parseDateBR('10/12', TODAY), '2026-12-10');
  assert.equal(parseDateBR('sexta', TODAY), '2026-11-20');
  assert.equal(norm('Fatura Cartão!'), 'fatura cartao');
  const items = [{ name: 'Aluguel Casa' }, { name: 'Aluguel da moto (trabalho)' }, { name: 'Conta de luz' }];
  assert.equal(matchByName('luz', items).match.name, 'Conta de luz');
  assert.equal(matchByName('aluguel da casa', items).match.name, 'Aluguel Casa');
  assert.equal(matchByName('aluguel', items).match, null); // ambíguo: casa ou moto
  assert.equal(matchByName('aluguel', items).ambiguous, true);
});

test('peças: validação em português', () => {
  const s = demo();
  const bad = normalizeRecipe({ piece: 'regra', profileId: 'prof_01', spec: { pote: 'nao-existe' } });
  const v = validateRecipe(bad, s);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('pote existente')));
  const panel = normalizeRecipe({ piece: 'painel', profileId: 'prof_01', spec: { titulo: 'Uber', formula: 'total / salario' } });
  assert.ok(validateRecipe(panel, s).errors[0].includes('salario'));
  const ok = normalizeRecipe({ piece: 'painel', profileId: 'prof_01', spec: { titulo: 'Uber em horas', formula: 'total / hora', texto: 'uber' } });
  assert.equal(validateRecipe(ok, s).ok, true);
});

test('painel: soma por texto e fórmula com horas de vida', () => {
  const s = demo();
  s.ledger.push({ id: 'u1', profileId: 'prof_01', date: '2026-11-10', direction: 'out', amount: 30, category: 'transporte', note: 'Uber centro', status: 'posted' });
  s.ledger.push({ id: 'u2', profileId: 'prof_01', date: '2026-11-15', direction: 'out', amount: 45, category: 'transporte', note: 'uber volta', status: 'posted' });
  s.ledger.push({ id: 'u3', profileId: 'prof_01', date: '2026-10-15', direction: 'out', amount: 99, category: 'transporte', note: 'uber mes passado', status: 'posted' });
  const r = normalizeRecipe({ piece: 'painel', profileId: 'prof_01', spec: { titulo: 'Uber', texto: 'uber', formula: 'total / hora', unidade: 'horas' } });
  const out = computePanel(s, 'prof_01', r, TODAY, { hora: 15 });
  assert.equal(out.total, 75);
  assert.equal(out.vezes, 2);
  assert.equal(out.value, 5);
});

test('lembretes: data, mensal e antes do vencimento; marcar feito', () => {
  const s = demo();
  s.recipes = [
    normalizeRecipe({ id: 'l1', piece: 'lembrete', profileId: 'prof_01', spec: { texto: 'Ligar pro banco', tipo: 'data', data: '2026-11-19' } }),
    normalizeRecipe({ id: 'l2', piece: 'lembrete', profileId: 'prof_01', spec: { texto: 'Pagar a escola', tipo: 'mensal', dia: 10 } }),
    normalizeRecipe({ id: 'l3', piece: 'lembrete', profileId: 'prof_01', spec: { texto: 'Separar o aluguel', tipo: 'antes_vencimento', conta: 'aluguel casa', dias: 7 } }),
    normalizeRecipe({ id: 'l4', piece: 'lembrete', profileId: 'prof_01', spec: { texto: 'Futuro', tipo: 'data', data: '2026-12-01' } }),
  ];
  const due = dueReminders(s, 'prof_01', TODAY);
  assert.deepEqual(due.map((d) => d.recipe.id).sort(), ['l1', 'l2', 'l3']);
  s.recipes[0] = markReminderDone(s.recipes[0], '2026-11-19');
  assert.ok(!dueReminders(s, 'prof_01', TODAY).some((d) => d.recipe.id === 'l1'));
});

test('regra: entrada nova separa no pote, no mesmo pacote de mudanças', () => {
  const s = demo();
  const pot = normalizeRecipe({ id: 'p1', piece: 'pote', profileId: 'prof_01', spec: { nome: 'Ração', meta: 200 } });
  const rule = normalizeRecipe({ id: 'r1', piece: 'regra', profileId: 'prof_01', spec: { pote: 'p1', quando: { texto: 'adiantamento' }, valor: 50 } });
  s.recipes = [pot, rule];
  const entry = { id: 'n1', profileId: 'prof_01', direction: 'in', amount: 840, status: 'posted', category: 'adiantamento', note: 'Adiantamento', date: TODAY };
  const { changes, notes } = applyRules(s, { ledger: [entry] });
  assert.equal(notes.length, 1);
  assert.equal(changes.recipes[0].state.guardado, 50);
  // gasto ou previsão não disparam
  assert.equal(applyRules(s, { ledger: [{ ...entry, direction: 'out' }] }).notes.length, 0);
  assert.equal(applyRules(s, { ledger: [{ ...entry, status: 'scheduled', forecast: true }] }).notes.length, 0);
  // percentual
  s.recipes[1] = normalizeRecipe({ ...rule, spec: { ...rule.spec, valor: 0, percentual: 10 } });
  assert.equal(applyRules(s, { ledger: [entry] }).changes.recipes[0].state.guardado, 84);
});

test('desfazer: peça criada some, peça alterada volta, peça apagada retorna', () => {
  const s = demo();
  const pot = normalizeRecipe({ id: 'p1', piece: 'pote', profileId: 'prof_01', spec: { nome: 'Gás', meta: 300 } });
  let a = newAction('a1', 'Criar pote');
  recordInverse(a, s, { recipes: [pot] });
  let s1 = apply(s, { recipes: [pot] });
  assert.deepEqual(buildUndo(a, s1).removeRecipes, ['p1']);

  const moved = movePot(pot, 120);
  a = newAction('a2', 'Guardar');
  recordInverse(a, s1, { recipes: [moved] });
  const s2 = apply(s1, { recipes: [moved] });
  const undo = buildUndo(a, s2);
  assert.equal(apply(s2, undo).recipes.find((r) => r.id === 'p1').state.guardado, 0);

  a = newAction('a3', 'Apagar');
  recordInverse(a, s2, { removeRecipes: ['p1'] });
  const s3 = apply(s2, { removeRecipes: ['p1'] });
  assert.equal(s3.recipes.length, 0);
  assert.equal(apply(s3, buildUndo(a, s3)).recipes[0].state.guardado, 120);
});

test('categorias criadas aparecem por direção', () => {
  const s = demo();
  s.recipes = [normalizeRecipe({ piece: 'categoria', profileId: 'prof_01', spec: { nome: 'Ração', direcao: 'saida' } })];
  assert.deepEqual(customCategories(s, 'prof_01', 'saida'), ['ração']);
  assert.deepEqual(customCategories(s, 'prof_01', 'entrada'), []);
});
