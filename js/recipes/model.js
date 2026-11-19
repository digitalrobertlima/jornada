// Peças: funções novas que a pessoa (ou o assistente) monta sem programar.
// Uma peça é DADO, não código: entra no backup, sincroniza, pode ser desfeita e desligada,
// e o app só executa o que cada tipo de peça permite.

import { num, round2, uid } from '../core/util.js';
import { addDays, diffDays } from '../core/dates.js';
import { norm } from '../core/text.js';
import { evaluate, variablesOf } from './formula.js';

export const PIECES = {
  categoria: { label: 'Categoria', hint: 'Um tipo novo de gasto ou entrada (ex.: ração, gorjeta).' },
  pote: { label: 'Pote', hint: 'Separar dinheiro para um objetivo (ex.: R$ 300 do gás até dia 10).' },
  regra: { label: 'Regra', hint: 'Quando entrar um dinheiro, separar parte num pote sozinho.' },
  lembrete: { label: 'Lembrete', hint: 'Avisar numa data, todo mês ou antes de uma conta vencer.' },
  painel: { label: 'Painel', hint: 'Um número na tela inicial (ex.: quanto gastei de Uber no mês).' },
};

export const PERIODS = { mes: 'este mês', '30d': 'últimos 30 dias', '7d': 'últimos 7 dias', ano: 'este ano' };
export const UNITS = { reais: 'R$', horas: 'horas de trabalho', numero: 'número', dias: 'dias' };
export const FORMULA_VARS = {
  total: 'soma do período', vezes: 'quantos lançamentos', media: 'valor médio', dias: 'dias do período',
  caixa: 'dinheiro livre hoje', hora: 'valor da sua hora de trabalho', essenciais: 'contas essenciais dos próximos 15 dias',
  dividas: 'total das dívidas em aberto',
};

const str = (x, max = 60) => String(x ?? '').trim().slice(0, max);

export function normalizeRecipe(r) {
  const piece = PIECES[r?.piece] ? r.piece : 'categoria';
  const s = r?.spec || {};
  let spec;
  switch (piece) {
    case 'categoria':
      spec = { nome: str(s.nome, 30).toLowerCase(), direcao: s.direcao === 'entrada' ? 'entrada' : 'saida' };
      break;
    case 'pote':
      spec = { nome: str(s.nome, 40), meta: round2(num(s.meta)), prazo: s.prazo || null };
      break;
    case 'regra':
      spec = {
        pote: s.pote || null,
        quando: { categoria: str(s.quando?.categoria, 30).toLowerCase(), texto: str(s.quando?.texto, 40), minimo: round2(num(s.quando?.minimo)) },
        valor: round2(num(s.valor)), percentual: Math.min(100, Math.max(0, num(s.percentual))),
      };
      break;
    case 'lembrete':
      spec = {
        texto: str(s.texto, 120), tipo: ['data', 'mensal', 'antes_vencimento'].includes(s.tipo) ? s.tipo : 'data',
        data: s.data || null, dia: Math.min(31, Math.max(1, Math.round(num(s.dia, 1)))),
        conta: str(s.conta, 60), dias: Math.min(30, Math.max(0, Math.round(num(s.dias, 2)))),
      };
      break;
    case 'painel':
      spec = {
        titulo: str(s.titulo, 40), direcao: ['saida', 'entrada', 'ambas'].includes(s.direcao) ? s.direcao : 'saida',
        categorias: Array.isArray(s.categorias) ? s.categorias.map((c) => str(c, 30).toLowerCase()).filter(Boolean).slice(0, 8) : [],
        texto: str(s.texto, 40), periodo: PERIODS[s.periodo] ? s.periodo : 'mes',
        formula: str(s.formula, 160), unidade: UNITS[s.unidade] ? s.unidade : 'reais',
      };
      break;
    default:
      spec = {};
  }
  const state = r?.state && typeof r.state === 'object' ? { ...r.state } : {};
  if (piece === 'pote') state.guardado = round2(num(state.guardado));
  if (piece === 'lembrete') state.feito = Array.isArray(state.feito) ? state.feito.slice(-12) : [];
  return {
    id: r?.id || uid('pec'),
    profileId: r?.profileId || null,
    piece,
    title: str(r?.title, 80) || autoTitle(piece, spec),
    enabled: r?.enabled !== false,
    createdBy: r?.createdBy === 'assistente' ? 'assistente' : 'voce',
    createdAt: r?.createdAt || new Date().toISOString(),
    spec,
    state,
  };
}

function autoTitle(piece, spec) {
  switch (piece) {
    case 'categoria': return `Categoria: ${spec.nome}`;
    case 'pote': return `Pote: ${spec.nome}`;
    case 'regra': return 'Regra automática';
    case 'lembrete': return `Lembrete: ${spec.texto}`;
    case 'painel': return spec.titulo || 'Painel';
    default: return 'Peça';
  }
}

/** Valida uma peça contra o estado atual. Devolve mensagens em português. */
export function validateRecipe(r, state, { pid } = {}) {
  const e = [];
  const s = r.spec;
  const mine = (state.recipes || []).filter((x) => x.profileId === (pid || r.profileId) && x.id !== r.id);
  switch (r.piece) {
    case 'categoria':
      if (!s.nome) e.push('Dê um nome à categoria.');
      if (mine.some((x) => x.piece === 'categoria' && norm(x.spec.nome) === norm(s.nome) && x.spec.direcao === s.direcao)) e.push('Essa categoria já existe.');
      break;
    case 'pote':
      if (!s.nome) e.push('Dê um nome ao pote.');
      if (s.meta < 0) e.push('A meta não pode ser negativa.');
      break;
    case 'regra': {
      const pot = mine.find((x) => x.id === s.pote && x.piece === 'pote');
      if (!pot) e.push('A regra precisa de um pote existente.');
      if (!(s.valor > 0) && !(s.percentual > 0)) e.push('Diga quanto separar: um valor ou uma porcentagem.');
      if (!s.quando.categoria && !s.quando.texto && !(s.quando.minimo > 0)) e.push('Diga quando a regra vale (categoria, nome da entrada ou valor mínimo).');
      break;
    }
    case 'lembrete':
      if (!s.texto) e.push('Escreva o que lembrar.');
      if (s.tipo === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(s.data || '')) e.push('Escolha a data do lembrete.');
      if (s.tipo === 'antes_vencimento' && !s.conta) e.push('Diga de qual conta é o vencimento.');
      break;
    case 'painel':
      if (!s.titulo) e.push('Dê um título ao painel.');
      if (s.formula) {
        try {
          const vars = variablesOf(s.formula);
          const bad = vars.filter((v) => !FORMULA_VARS[v]);
          if (bad.length) e.push(`A fórmula usa o que não existe: ${bad.join(', ')}. Pode usar: ${Object.keys(FORMULA_VARS).join(', ')}.`);
          else evaluate(s.formula, Object.fromEntries(Object.keys(FORMULA_VARS).map((k) => [k, 1])));
        } catch (err) {
          e.push(`Fórmula: ${err.message}`);
        }
      }
      break;
    default:
      e.push('Tipo de peça desconhecido.');
  }
  return { ok: e.length === 0, errors: e };
}

export const recipesOf = (state, pid, piece = null) => (state.recipes || [])
  .filter((r) => r.profileId === pid && (!piece || r.piece === piece));

/** Categorias criadas pela pessoa. */
export function customCategories(state, pid, direcao) {
  return recipesOf(state, pid, 'categoria').filter((r) => r.enabled && r.spec.direcao === direcao).map((r) => r.spec.nome);
}

// ---------------------------------------------------------------- descrição em linguagem simples

export function describeRecipe(r, state) {
  const s = r.spec;
  const brl = (v) => `R$ ${round2(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
  switch (r.piece) {
    case 'categoria': return `Nova categoria de ${s.direcao === 'entrada' ? 'entrada' : 'gasto'}: "${s.nome}". Aparece no lançamento rápido.`;
    case 'pote': return `Pote "${s.nome}"${s.meta ? ` com meta de ${brl(s.meta)}` : ''}${s.prazo ? ` até ${s.prazo.split('-').reverse().join('/')}` : ''}. O dinheiro continua na sua conta: o pote só marca para que ele é.`;
    case 'regra': {
      const pot = (state.recipes || []).find((x) => x.id === s.pote);
      const cond = [s.quando.categoria && `da categoria "${s.quando.categoria}"`, s.quando.texto && `com "${s.quando.texto}" no nome`, s.quando.minimo > 0 && `de ${brl(s.quando.minimo)} ou mais`].filter(Boolean).join(' e ');
      const how = s.percentual > 0 ? `${s.percentual}%` : brl(s.valor);
      return `Quando entrar dinheiro ${cond || ''}, separar ${how} no pote "${pot?.spec.nome || '?'}". Acontece junto com o registro e dá para desfazer.`;
    }
    case 'lembrete':
      if (s.tipo === 'mensal') return `Todo dia ${s.dia}: "${s.texto}".`;
      if (s.tipo === 'antes_vencimento') return `${s.dias} ${s.dias === 1 ? 'dia' : 'dias'} antes de vencer "${s.conta}": "${s.texto}".`;
      return `Em ${(s.data || '').split('-').reverse().join('/')}: "${s.texto}".`;
    case 'painel': {
      const filt = [s.categorias.length && `categorias ${s.categorias.join(', ')}`, s.texto && `com "${s.texto}" na descrição`].filter(Boolean).join(' e ');
      return `Mostra na tela inicial: ${s.direcao === 'entrada' ? 'entradas' : s.direcao === 'ambas' ? 'entradas e saídas' : 'gastos'}${filt ? ` (${filt})` : ''}, ${PERIODS[s.periodo]}${s.formula ? `, calculado como ${s.formula}` : ''}.`;
    }
    default: return '';
  }
}

// ---------------------------------------------------------------- cálculo das peças

function periodStart(periodo, today) {
  if (periodo === '7d') return addDays(today, -6);
  if (periodo === '30d') return addDays(today, -29);
  if (periodo === 'ano') return `${today.slice(0, 4)}-01-01`;
  return `${today.slice(0, 7)}-01`;
}

/** Valor de um painel. ctx: { caixa, hora, essenciais, dividas } */
export function computePanel(state, pid, r, today, ctx = {}) {
  const s = r.spec;
  const start = periodStart(s.periodo, today);
  const cats = s.categorias.map(norm);
  const txt = norm(s.texto);
  const entries = state.ledger.filter((e) => e.profileId === pid && e.status !== 'scheduled' && e.date >= start && e.date <= today
    && (s.direcao === 'ambas' || (s.direcao === 'entrada' ? e.direction === 'in' : e.direction === 'out'))
    && (!cats.length || cats.includes(norm(e.category)))
    && (!txt || norm(`${e.note} ${e.category}`).includes(txt)));
  const total = round2(entries.reduce((acc, e) => acc + (s.direcao === 'ambas' && e.direction === 'out' ? -e.amount : e.amount), 0));
  const vezes = entries.length;
  const vars = {
    total, vezes, media: vezes ? round2(total / vezes) : 0, dias: diffDays(start, today) + 1,
    caixa: num(ctx.caixa), hora: num(ctx.hora), essenciais: num(ctx.essenciais), dividas: num(ctx.dividas),
  };
  let value = total;
  let error = null;
  if (s.formula) {
    try { value = evaluate(s.formula, vars); } catch (err) { error = err.message; value = null; }
  }
  return { value, total, vezes, vars, error, start, entries };
}

/** Lembretes que devem aparecer hoje. */
export function dueReminders(state, pid, today) {
  const out = [];
  for (const r of recipesOf(state, pid, 'lembrete')) {
    if (!r.enabled) continue;
    const s = r.spec;
    const done = r.state.feito || [];
    if (s.tipo === 'data') {
      if (s.data && today >= s.data && !done.includes(s.data)) out.push({ recipe: r, key: s.data, date: s.data, text: s.texto });
    } else if (s.tipo === 'mensal') {
      const [y, m] = today.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const occ = `${today.slice(0, 8)}${String(Math.min(s.dia, last)).padStart(2, '0')}`;
      if (today >= occ && !done.includes(occ)) out.push({ recipe: r, key: occ, date: occ, text: s.texto });
    } else if (s.tipo === 'antes_vencimento') {
      const q = norm(s.conta);
      const obs = state.obligations.filter((o) => o.status !== 'paid' && o.dueDate && (o.profileId === pid || o.isShared)
        && (norm(o.beneficiary).includes(q) || q.includes(norm(o.beneficiary))));
      for (const o of obs) {
        const from = addDays(o.dueDate, -s.dias);
        if (today >= from && today <= o.dueDate && !done.includes(o.dueDate)) {
          out.push({ recipe: r, key: o.dueDate, date: o.dueDate, text: s.texto, obligation: o });
        }
      }
    }
  }
  return out;
}

/** Marca a ocorrência de um lembrete como feita (devolve a peça atualizada). */
export function markReminderDone(r, key) {
  return { ...r, state: { ...r.state, feito: [...(r.state.feito || []).filter((k) => k !== key), key].slice(-12) } };
}

/** Guarda (valor > 0) ou tira (valor < 0) dinheiro de um pote. */
export function movePot(r, valor) {
  const next = round2(Math.max(0, num(r.state.guardado) + num(valor)));
  return { ...r, state: { ...r.state, guardado: next } };
}

/**
 * Regras: dado um conjunto de mudanças que está para ser gravado, acrescenta o efeito das regras
 * (separar dinheiro em potes) para cada ENTRADA nova já realizada. Devolve { changes, notes }.
 */
export function applyRules(state, changes) {
  const notes = [];
  const recipes = state.recipes || [];
  const rules = recipes.filter((r) => r.piece === 'regra' && r.enabled);
  if (!rules.length || !changes.ledger?.length) return { changes, notes };
  const newIncomes = changes.ledger.filter((e) => {
    if (e.direction !== 'in' || e.status === 'scheduled' || e.forecast) return false;
    const prior = state.ledger.find((x) => x.id === e.id);
    return !prior || prior.status === 'scheduled';
  });
  if (!newIncomes.length) return { changes, notes };
  const out = { ...changes, recipes: [...(changes.recipes || [])] };
  const current = (id) => out.recipes.find((x) => x.id === id) || recipes.find((x) => x.id === id);
  for (const e of newIncomes) {
    for (const rule of rules.filter((r) => r.profileId === e.profileId)) {
      const q = rule.spec.quando;
      if (q.categoria && norm(e.category) !== norm(q.categoria)) continue;
      if (q.texto && !norm(`${e.note} ${e.category}`).includes(norm(q.texto))) continue;
      if (q.minimo > 0 && e.amount < q.minimo) continue;
      const pot = current(rule.spec.pote);
      if (!pot || !pot.enabled) continue;
      const amount = round2(rule.spec.percentual > 0 ? (e.amount * rule.spec.percentual) / 100 : Math.min(rule.spec.valor, e.amount));
      if (amount <= 0) continue;
      const moved = movePot(pot, amount);
      const i = out.recipes.findIndex((x) => x.id === moved.id);
      if (i >= 0) out.recipes[i] = moved; else out.recipes.push(moved);
      notes.push({ pot: pot.spec.nome, amount, rule: rule.title });
    }
  }
  return { changes: out, notes };
}
