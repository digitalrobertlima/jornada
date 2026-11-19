// Catálogo de ferramentas: tudo o que o assistente pode fazer no app, pelas MESMAS funções dos botões.
// Ferramentas de leitura devolvem texto. Ferramentas de escrita devolvem uma PRÉVIA e só gravam
// quando a pessoa confirma — e tudo vai para o histórico, então dá para desfazer.
// Os números vêm sempre dos motores do app, nunca do modelo de linguagem.

import { brl, dateHuman, lifeTime } from '../core/format.js';
import { num, round2, uid } from '../core/util.js';
import { addDays } from '../core/dates.js';
import { norm, matchByName, parseMoneyBR, parseDateBR } from '../core/text.js';
import { normalizeObligation, normalizeAccount, isRealLiquidity, VITAL_KINDS, ACCOUNT_TYPES } from '../core/model.js';
import { addLedgerEntry, payObligation } from '../engines/cashflow.js';
import {
  INCOME_KINDS, addForecast, confirmForecast, pendingForecasts, planDistribution,
} from '../engines/forecast.js';
import { buildGuide } from '../engines/guide.js';
import { describeAction } from '../engines/journal.js';
import {
  normalizeRecipe, validateRecipe, describeRecipe, recipesOf, movePot, customCategories, FORMULA_VARS,
} from '../recipes/model.js';
import { evaluate } from '../recipes/formula.js';

// ---------------------------------------------------------------- conversão de argumentos

const money = (v) => (typeof v === 'number' ? round2(v) : parseMoneyBR(v));
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const yes = (v) => v === true || /^(sim|s|true|1|yes)$/i.test(String(v ?? '').trim());
function dateArg(v, today) {
  if (!v) return null;
  if (isISO(v)) return v;
  return parseDateBR(String(v), today);
}
const plural = (n, a, b) => (n === 1 ? a : b);

const IN_CATS = [
  ['salário', /salario|quinzena|pagamento do mes|holerite/], ['adiantamento', /adiantamento|vale do dia 20|metade/],
  ['venda', /venda|vendi/], ['reembolso', /reembolso|devolu/], ['extra', /bico|extra|freela|corrida|entrega|diaria/],
];
const OUT_CATS = [
  ['mercado', /mercado|feira|padaria|acougue|sacolao|supermercado|hortifruti/],
  ['transporte', /uber|99|onibus|metro|gasolina|combustivel|passagem|transporte|moto|estacionamento|pedagio/],
  ['casa', /gas|luz|agua|internet|condominio|aluguel|casa|reforma/], ['saúde', /farmacia|remedio|medico|consulta|exame|dentista/],
  ['lazer', /ifood|lanche|bar|cinema|show|pizza|restaurante|cerveja|lazer/], ['trabalho', /material|ferramenta|trabalho|insumo/],
];
function guessCategory(text, dir, custom = []) {
  const t = norm(text);
  for (const c of custom) if (t.includes(norm(c))) return c;
  for (const [c, re] of dir === 'in' ? IN_CATS : OUT_CATS) if (re.test(t)) return c;
  return dir === 'in' ? 'extra' : 'outros';
}

function guessIncomeKind(text) {
  const t = norm(text);
  if (/vale transporte|\bvt\b|transporte/.test(t)) return 'vale_transporte';
  if (/vale alimentacao|vale refeicao|\bva\b|\bvr\b|alimentacao|refeicao|ticket|caju|alelo|sodexo|flash|pluxee/.test(t)) return 'vale_alimentacao';
  if (/adiantamento|vale do dia/.test(t)) return 'adiantamento';
  if (/salario|quinzena|holerite|pagamento/.test(t)) return 'salario';
  if (/bico|extra|venda|freela|corrida/.test(t)) return 'extra';
  return 'outro';
}

function guessVitalKind(name) {
  const t = norm(name);
  if (/aluguel|condominio|financiamento da casa|prestacao da casa/.test(t)) return 'moradia';
  if (/luz|energia|agua|gas|esgoto|cemig|copasa|sabesp|enel|light/.test(t)) return 'contas';
  if (/mercado|comida|alimentacao|feira/.test(t)) return 'alimentacao';
  if (/onibus|transporte|passagem|gasolina|combustivel/.test(t)) return 'transporte';
  if (/pensao/.test(t)) return 'pensao';
  if (/escola|faculdade|curso|creche|mensalidade/.test(t)) return 'educacao';
  if (/plano de saude|saude|remedio|farmacia/.test(t)) return 'saude';
  if (/moto|ferramenta|maquina|celular de trabalho/.test(t)) return 'trabalho';
  return 'contas';
}

// ---------------------------------------------------------------- catálogo

export function createTools(api) {
  const T = {};
  const def = (name, kind, desc, params, run) => { T[name] = { name, kind, desc, params, run }; };

  const ctx = () => {
    const d = api.derive();
    if (!d) throw new Error('Ainda não há perfil. Complete o cadastro inicial primeiro.');
    return { d, state: api.state(), today: api.today(), pid: d.pid };
  };
  const debtItems = (d, withQuarantine = true) => [...d.tri.frontline, ...d.tri.battlefield, ...(withQuarantine ? d.tri.quarantine : [])];
  const accountsOf = (state, pid) => state.accounts.filter((a) => a.profileId === pid);
  const liquidAccounts = (state, pid) => accountsOf(state, pid).filter(isRealLiquidity);

  function resolve(query, items, getName, what) {
    if (!items.length) throw new Error(`Não há ${what} cadastrado(a).`);
    const { match, candidates, ambiguous } = matchByName(query, items, getName);
    if (match) return match;
    if (ambiguous) {
      const err = new Error(`Qual ${what}? ${candidates.map(getName).join(' ou ')}?`);
      err.options = candidates.map(getName);
      err.query = query;
      throw err;
    }
    const err = new Error(`Não achei ${what} parecido com "${query}". Tenho: ${items.slice(0, 8).map(getName).join(', ')}.`);
    err.options = items.slice(0, 8).map(getName);
    err.query = query;
    throw err;
  }

  function pickAccount(state, pid, query, { prefer = 'liquid' } = {}) {
    const all = accountsOf(state, pid);
    if (query) return resolve(query, all, (a) => a.name, 'conta');
    const pool = prefer === 'locked' ? all.filter((a) => a.type === 'benefit_card') : liquidAccounts(state, pid);
    return pool[0] || null;
  }

  // ------------------------------------------------------------ leitura

  def('situacao', 'read', 'Resumo de agora: dinheiro livre, travado em vale, contas essenciais, dívidas e próximo passo.', {}, () => {
    const { d, state, today, pid } = ctx();
    const deficit = round2(Math.max(0, d.wl.floor - d.cash));
    const debts = debtItems(d).filter((i) => !i.isVital);
    const late = debtItems(d, false).filter((i) => i.late > 0);
    const next = pendingForecasts(state, pid).find((e) => e.liquidity !== 'locked');
    const steps = buildGuide(d, { state });
    const lines = [
      `Dinheiro livre (conta/Pix): ${brl(d.cash)}.`,
      d.liq.benefit > 0 ? `Travado em vale/benefício: ${brl(d.liq.benefit)} (só serve no cartão).` : null,
      `Contas essenciais dos próximos 15 dias: ${brl(d.wl.floor)} — ${deficit > 0 ? `faltam ${brl(deficit)}` : `cobertas, sobram ${brl(d.cash - d.wl.floor)}`}.`,
      `Dívidas em aberto: ${debts.length} (${brl(debts.reduce((s, i) => s + i.updated, 0))}).`,
      late.length ? `Atrasadas: ${late.map((i) => `${i.ob.beneficiary} há ${i.late} ${plural(i.late, 'dia', 'dias')}`).join('; ')}.` : 'Nada atrasado.',
      next ? `Próxima entrada prevista: ${next.note} ${brl(next.amount)} em ${dateHuman(next.date)}${next.date < today ? ' (já devia ter caído)' : ''}.` : 'Nenhuma entrada prevista cadastrada.',
      steps[0] ? `Próximo passo sugerido: ${steps[0].title}.` : null,
    ];
    return { text: lines.filter(Boolean).join('\n') };
  });

  def('o_que_fazer', 'read', 'Os próximos passos recomendados pelo guia do app, em ordem.', {}, () => {
    const { d, state } = ctx();
    const steps = buildGuide(d, { state }).slice(0, 3);
    return { text: steps.map((s, i) => `${i + 1}. ${s.title}. ${s.why}`).join('\n') || 'Tudo em dia.' };
  });

  def('contas_a_pagar', 'read', 'Lista contas e dívidas com valor, vencimento e se está atrasada.', { filtro: 'atrasadas | proximas | todas (opcional)' }, ({ filtro } = {}) => {
    const { d } = ctx();
    let items = debtItems(d, filtro === 'todas');
    if (filtro === 'atrasadas') items = items.filter((i) => i.late > 0);
    if (filtro === 'proximas') items = items.filter((i) => i.daysToDue !== null && i.daysToDue <= 15);
    if (!items.length) return { text: 'Nenhuma conta nesse filtro.' };
    const line = (i) => `• ${i.ob.beneficiary}: ${brl(i.dueNow)}${i.installment ? ` (${i.installment.label})` : ''} — ${i.late > 0 ? `ATRASADA há ${i.late} ${plural(i.late, 'dia', 'dias')}` : i.ob.dueDate ? `vence ${dateHuman(i.ob.dueDate)}` : 'sem data'}${i.isVital ? ' · essencial' : ''}${i.isProtestable ? ' · pode ir a cartório' : ''}${i.zone === 'quarantine' ? ' · guardada para depois' : ''}`;
    return { text: `${items.slice(0, 14).map(line).join('\n')}\nTotal que vence agora: ${brl(items.reduce((s, i) => s + i.dueNow, 0))}.` };
  });

  def('minhas_contas', 'read', 'Contas bancárias, vales e cartões com saldo ou limite.', {}, () => {
    const { state, pid } = ctx();
    const accs = accountsOf(state, pid);
    if (!accs.length) return { text: 'Nenhuma conta cadastrada.' };
    return {
      text: accs.map((a) => {
        if (a.type === 'checking_cash') return `• ${a.name} (conta/Pix, livre): ${brl(a.balance)}`;
        if (a.type === 'benefit_card') return `• ${a.name} (vale de ${a.lock === 'transporte' ? 'transporte' : a.lock === 'outro' ? 'outro uso' : 'alimentação'}, travado): ${brl(a.balance)}`;
        if (a.type === 'credit_card') return `• ${a.name} (cartão de crédito): limite disponível ${brl(a.limitAvailable)} de ${brl(a.limitTotal)}${a.limitShrinking ? ' · banco cortando limite' : ''}`;
        return `• ${a.name} (${ACCOUNT_TYPES[a.type]?.label || a.type}): garantia livre ${brl(a.limitAvailable)}`;
      }).join('\n'),
    };
  });

  def('plano', 'read', 'Como distribuir o dinheiro que vai entrar entre as contas que vencem.', {}, () => {
    const { d, state, today, pid } = ctx();
    const p = planDistribution(state, pid, today, d.tri, { reserveTarget: d.profile?.shieldTarget || 500 });
    if (!p.hasForecast) return { text: 'Não há entradas previstas. Cadastre salário, adiantamento ou vale com "prever_entrada" para montar o plano.' };
    const head = { ok: 'Dá para pagar tudo que vence no período.', tight: 'As essenciais fecham, mas alguma dívida não cabe inteira.', short: 'Falta dinheiro para pelo menos uma conta essencial na data.' }[p.verdict];
    const out = [head];
    p.moments.forEach((m, i) => {
      const title = i === 0 ? `Hoje (você tem ${brl(p.cashNow)})` : `${dateHuman(m.date)}: entra ${m.label} ${brl(m.income)}`;
      const parts = m.lines.map((l) => `${l.kind === 'antecipar' ? 'adiantar' : 'pagar'} ${l.name} ${brl(l.amount)}${l.paidWith === 'vale' ? ' (no vale)' : ''}`);
      if (m.held > 0.004) parts.push(`segurar ${brl(m.held)} para essenciais seguintes`);
      if (m.reserve > 0.004) parts.push(`guardar ${brl(m.reserve)} de reserva`);
      out.push(`${title}: ${parts.join('; ') || 'nada vence'}.`);
    });
    for (const g of p.gaps.filter((x) => !x.resolvedAt || x.resolvedAt > x.date)) {
      out.push(`Aperto: ${g.name} vence ${dateHuman(g.date)} (${brl(g.amount)})${g.resolvedAt ? `, mas o dinheiro só entra ${dateHuman(g.resolvedAt)}` : `, faltam ${brl(g.missing)}`}. Sugestão: pedir nova data.`);
    }
    return { text: out.join('\n') };
  });

  def('previsoes', 'read', 'Entradas previstas que ainda não caíram.', {}, () => {
    const { state, today, pid } = ctx();
    const list = pendingForecasts(state, pid);
    if (!list.length) return { text: 'Nenhuma entrada prevista.' };
    return { text: list.map((e) => `• ${e.note}: ${brl(e.amount)} em ${dateHuman(e.date)} — ${e.liquidity === 'locked' ? 'travado no vale' : 'livre (Pix)'}${e.date < today ? ' · já devia ter caído' : ''}${e.repeat ? ' · todo mês' : ''}`).join('\n') };
  });

  def('lancamentos', 'read', 'Entradas e gastos já lançados, com totais.', { dias: 'quantos dias para trás (opcional, padrão 30)', texto: 'palavra na descrição (opcional)', tipo: 'gastos | entradas (opcional)' }, ({ dias, texto, tipo } = {}) => {
    const { state, today, pid } = ctx();
    const from = addDays(today, -Math.max(1, Math.min(366, Math.round(num(dias, 30)))) + 1);
    const q = norm(texto);
    const list = state.ledger.filter((e) => e.profileId === pid && e.status !== 'scheduled' && e.date >= from && e.date <= today
      && (!q || norm(`${e.note} ${e.category}`).includes(q))
      && (!tipo || (/entrada/.test(tipo) ? e.direction === 'in' : e.direction === 'out')))
      .sort((a, b) => b.date.localeCompare(a.date));
    const tin = list.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    const tout = list.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    return {
      text: `Desde ${dateHuman(from)}${q ? ` com "${texto}"` : ''}: ${list.length} ${plural(list.length, 'lançamento', 'lançamentos')}, entradas ${brl(tin)}, gastos ${brl(tout)}.\n`
        + list.slice(0, 8).map((e) => `• ${dateHuman(e.date)} ${e.direction === 'in' ? '+' : '−'}${brl(e.amount)} ${e.note || e.category}`).join('\n'),
    };
  });

  def('ultimas_acoes', 'read', 'As últimas ações feitas no app (que podem ser desfeitas).', {}, () => {
    const j = api.journal() || [];
    return { text: j.slice(0, 6).map((a, i) => `${i + 1}. ${a.label}`).join('\n') || 'Nenhuma ação recente.' };
  });

  def('calcular', 'read', 'Faz uma conta com segurança. Pode usar números e: caixa, hora, essenciais, dividas.', { expressao: 'ex.: 1250 - 840, ou caixa - essenciais' }, ({ expressao } = {}) => {
    const { d } = ctx();
    const debts = debtItems(d).filter((i) => !i.isVital);
    const vars = { caixa: d.cash, hora: d.rate, essenciais: d.wl.floor, dividas: round2(debts.reduce((s, i) => s + i.updated, 0)) };
    const v = evaluate(String(expressao || ''), vars);
    return { text: `${expressao} = ${String(v).replace('.', ',')}` };
  });

  def('pecas', 'read', 'Peças que a pessoa já criou (potes, regras, lembretes, painéis, categorias).', {}, () => {
    const { state, pid } = ctx();
    const list = recipesOf(state, pid);
    return { text: list.map((r) => `• ${r.title}${r.enabled ? '' : ' (desligada)'}: ${describeRecipe(r, state)}`).join('\n') || 'Nenhuma peça criada.' };
  });

  // ------------------------------------------------------------ escrita (prévia + confirmação)

  def('registrar_entrada', 'write', 'Registra dinheiro que ENTROU (caiu). Se for uma entrada prevista, confirma a previsão.', {
    valor: 'número', descricao: 'ex.: adiantamento, bico (opcional)', conta: 'nome da conta (opcional)', data: 'opcional, padrão hoje',
  }, (a = {}) => {
    const { state, today, pid } = ctx();
    const desc = String(a.descricao || a.previsao || '').trim();
    let valor = money(a.valor);
    // previsão parecida → confirmar que caiu
    const pend = pendingForecasts(state, pid).filter((e) => e.date <= addDays(today, 10) && e.date >= addDays(today, -40));
    let fc = null;
    if (desc && pend.length) {
      const m = matchByName(desc, pend, (e) => `${e.note} ${INCOME_KINDS[e.kind]?.label || ''}`);
      fc = m.match || (m.candidates.length === 1 ? m.candidates[0] : null);
    }
    if (!fc && !desc && valor > 0) {
      const same = pend.filter((e) => Math.abs(e.amount - valor) <= Math.max(1, e.amount * 0.01));
      if (same.length === 1) fc = same[0];
    }
    if (fc) {
      if (!(valor > 0)) valor = fc.amount;
      const acc = state.accounts.find((x) => x.id === fc.accountId);
      const res = confirmForecast(state, fc.id, { amount: valor, date: today, today });
      return {
        preview: {
          title: 'Confirmar que caiu',
          lines: [`${fc.note}: ${brl(valor)}${Math.abs(valor - fc.amount) > 0.004 ? ` (previsto era ${brl(fc.amount)})` : ''}`,
            `Vai para ${acc?.name || 'a conta'}${fc.liquidity === 'locked' ? ' — saldo travado, só serve no cartão' : ''}`,
            fc.repeat ? 'O do mês que vem já fica previsto.' : null].filter(Boolean),
        },
        execute: async () => {
          const act = await api.commit(res.changes, { label: `Caiu: ${fc.note} (${brl(valor)})` });
          return { text: `Pronto: ${brl(valor)} de ${fc.note} ${fc.liquidity === 'locked' ? 'no vale' : 'na conta'}.`, actionId: act?.id };
        },
      };
    }
    if (!(valor > 0)) throw new Error('Quanto entrou?');
    const isVale = /\bvale\b|alimenta|refei|\bva\b|\bvr\b|\bvt\b/.test(norm(desc));
    const acc = pickAccount(state, pid, a.conta, { prefer: isVale ? 'locked' : 'liquid' }) || pickAccount(state, pid, null);
    if (!acc) throw new Error('Cadastre uma conta primeiro (ex.: "cadastrar conta Nubank").');
    const date = dateArg(a.data, today) || today;
    const category = a.categoria ? String(a.categoria).toLowerCase() : guessCategory(desc, 'in', customCategories(state, pid, 'entrada'));
    const res = addLedgerEntry(state, { profileId: pid, direction: 'in', amount: valor, accountId: acc.id, category, note: desc || category, date }, { today, btcPrice: api.btcPrice() });
    return {
      preview: {
        title: 'Registrar entrada',
        lines: [`+${brl(valor)} · ${desc || category}`, `Em ${acc.name}${acc.type === 'benefit_card' ? ' (travado)' : ''}${date !== today ? ` · ${date > today ? 'agendado para' : 'em'} ${dateHuman(date)}` : ''}`],
      },
      execute: async () => {
        const act = await api.commit(res.changes, { label: `Entrada: ${desc || category} (${brl(valor)})` });
        return { text: `Registrado: +${brl(valor)} em ${acc.name}.`, actionId: act?.id };
      },
    };
  });

  def('registrar_gasto', 'write', 'Registra um gasto (dinheiro que SAIU) que não é pagamento de conta cadastrada.', {
    valor: 'número', descricao: 'ex.: uber, mercado', categoria: 'opcional', conta: 'de qual conta saiu (opcional)', data: 'opcional',
  }, (a = {}) => {
    const { d, state, today, pid } = ctx();
    const valor = money(a.valor);
    if (!(valor > 0)) throw new Error('Quanto foi o gasto?');
    const desc = String(a.descricao || '').trim();
    const category = a.categoria ? String(a.categoria).toLowerCase() : guessCategory(desc, 'out', customCategories(state, pid, 'saida'));
    const acc = pickAccount(state, pid, a.conta);
    if (!acc) throw new Error('Cadastre uma conta primeiro.');
    const date = dateArg(a.data, today) || today;
    const res = addLedgerEntry(state, { profileId: pid, direction: 'out', amount: valor, accountId: acc.id, category, note: desc || category, date }, { today, btcPrice: api.btcPrice() });
    const warn = isRealLiquidity(acc) && acc.balance < valor ? `${acc.name} tem ${brl(acc.balance)}: vai ficar negativa.` : null;
    const pressure = isRealLiquidity(acc) && d.cash - valor < d.wl.floor && d.wl.floor > 0
      ? `Depois disso faltam ${brl(d.wl.floor - (d.cash - valor))} para as contas essenciais dos próximos 15 dias.` : null;
    return {
      preview: { title: 'Registrar gasto', lines: [`−${brl(valor)} · ${desc || category} (${category})`, `Sai de ${acc.name}`], warn: warn || pressure },
      execute: async () => {
        const act = await api.commit(res.changes, { label: `Saída: ${desc || category} (${brl(valor)})` });
        return { text: `Registrado: −${brl(valor)} em ${acc.name}.`, actionId: act?.id };
      },
    };
  });

  def('pagar', 'write', 'Registra o pagamento de uma conta ou dívida cadastrada (parcela, parte ou tudo).', {
    conta: 'nome da conta/dívida', valor: 'opcional: padrão é o que vence agora', de_onde: 'conta de onde saiu (opcional)', quitar_com_desconto: 'sim se pagou menos e quitou tudo (opcional)',
  }, (a = {}) => {
    const { d, state, today, pid } = ctx();
    if (!a.conta) throw new Error('Qual conta você pagou?');
    const item = resolve(String(a.conta), debtItems(d), (i) => i.ob.beneficiary, 'conta');
    const settle = yes(a.quitar_com_desconto);
    let valor = money(a.valor);
    if (!(valor > 0)) {
      if (settle) throw new Error('Quanto você pagou para quitar com desconto?');
      valor = item.dueNow;
    }
    const liquid = liquidAccounts(state, pid);
    const acc = a.de_onde ? resolve(String(a.de_onde), liquid, (x) => x.name, 'conta') : liquid[0] || null;
    const res = payObligation(state, { obligationId: item.id, profileId: pid, amount: valor, accountId: acc?.id || null, date: today, settle }, { today, btcPrice: api.btcPrice() });
    const lines = [
      `${item.ob.beneficiary}: ${brl(valor)}${item.installment && !settle ? ` (${item.installment.label})` : ''}${res.fullyPaid ? ' — quita esta conta' : ''}`,
      acc ? `Sai de ${acc.name}: ${brl(acc.balance)} → ${brl(acc.balance - valor)}` : 'Pago por fora (não mexe nos saldos)',
      res.rescue.minutes > 0 ? `Evita multa/juros: +${lifeTime(res.rescue.minutes)} de vida` : null,
    ].filter(Boolean);
    let warn = null;
    if (acc && acc.balance < valor) warn = `${acc.name} só tem ${brl(acc.balance)}.`;
    else if (!item.isVital && !item.isProtestable && d.cash - valor < d.wl.floor) {
      warn = `Cuidado: depois disso faltam ${brl(d.wl.floor - (d.cash - valor))} para as contas essenciais (aluguel, luz, comida). Só pague se essa dívida não puder esperar.`;
    }
    return {
      preview: { title: settle ? 'Quitar com desconto' : 'Registrar pagamento', lines, warn },
      execute: async () => {
        const act = await api.commit(res.changes, { label: `Pagamento: ${item.ob.beneficiary} (${brl(valor)})` });
        return { text: res.fullyPaid ? `Quitado: ${item.ob.beneficiary}! Uma dívida a menos.` : `Pago: ${brl(valor)} de ${item.ob.beneficiary}.`, actionId: act?.id, celebrate: res.fullyPaid };
      },
    };
  });

  def('prever_entrada', 'write', 'Cadastra um dinheiro que VAI cair: salário, adiantamento, vale-alimentação, vale-transporte, extra.', {
    tipo: 'salario | adiantamento | vale_alimentacao | vale_transporte | extra | outro', valor: 'número', data: 'dia em que deve cair', livre: 'sim = cai via Pix/conta; nao = travado no vale (opcional)', repete: 'sim se repete todo mês (opcional)',
  }, (a = {}) => {
    const { state, today, pid } = ctx();
    const kind = INCOME_KINDS[a.tipo] ? a.tipo : guessIncomeKind(`${a.tipo || ''} ${a.descricao || ''}`);
    const info = INCOME_KINDS[kind];
    const valor = money(a.valor);
    if (!(valor > 0)) throw new Error(`Quanto vai cair de ${info.label.toLowerCase()}?`);
    const date = dateArg(a.data, today);
    if (!date) throw new Error('Em que dia deve cair?');
    if (date < today) throw new Error('A data já passou. Se já caiu, use "registrar_entrada".');
    const locked = a.livre === undefined || a.livre === null || a.livre === '' ? info.liquidity === 'locked' : !yes(a.livre);
    const monthlyByDefault = ['salario', 'adiantamento', 'vale_alimentacao', 'vale_transporte'].includes(kind);
    const input = { profileId: pid, kind, amount: valor, date, repeat: yes(a.repete) || monthlyByDefault ? 'monthly' : null };
    if (a.repete !== undefined && a.repete !== '' && !yes(a.repete)) input.repeat = null;
    let accName;
    if (locked) {
      const lock = info.lock || 'alimentacao';
      const acc = state.accounts.find((x) => x.profileId === pid && x.type === 'benefit_card' && (x.lock || 'alimentacao') === lock);
      if (acc) { input.accountId = acc.id; accName = acc.name; } else {
        input.newAccount = { type: 'benefit_card', name: lock === 'transporte' ? 'Vale-transporte' : 'Vale-alimentação', balance: 0, lock };
        accName = `${input.newAccount.name} (novo)`;
      }
    } else {
      const acc = liquidAccounts(state, pid)[0];
      if (acc) { input.accountId = acc.id; accName = acc.name; } else {
        input.newAccount = { type: 'checking_cash', name: 'Conta principal', balance: 0 };
        accName = 'Conta principal (nova)';
      }
    }
    const res = addForecast(state, input, { today });
    return {
      preview: {
        title: 'Prever entrada',
        lines: [`${info.label}: ${brl(valor)} em ${dateHuman(date)}`, `${locked ? 'Travado em' : 'Livre, cai em'} ${accName}`, input.repeat ? 'Repete todo mês' : 'Só desta vez'],
      },
      execute: async () => {
        const act = await api.commit(res.changes, { label: `Previsão: ${info.label} (${brl(valor)}) em ${dateHuman(date)}` });
        return { text: `Previsto: ${info.label} ${brl(valor)} em ${dateHuman(date)}. O plano de distribuição já conta com ele.`, actionId: act?.id };
      },
    };
  });

  def('cadastrar_divida', 'write', 'Cadastra uma conta ou dívida nova.', {
    tipo: 'essencial (aluguel, luz, água…) | boleto | pessoa | emprestimo | cartao', nome: 'quem cobra / o que é', valor: 'total que falta (ou valor da conta)',
    vencimento: 'data (opcional para dívidas)', parcela: 'valor da parcela (opcional)', parcelas: 'quantas faltam (opcional)', juros_mes: '% ao mês (opcional)',
  }, (a = {}) => {
    const { today, pid } = ctx();
    const t = norm(a.tipo);
    const nome = String(a.nome || '').trim();
    if (!nome) throw new Error('Qual o nome da conta ou de quem cobra?');
    const parcela = money(a.parcela);
    const parcelas = Math.round(num(a.parcelas));
    let valor = money(a.valor);
    if (!(valor > 0) && parcela > 0 && parcelas > 0) valor = round2(parcela * parcelas);
    if (!(valor > 0)) throw new Error('Qual o valor?');
    const due = dateArg(a.vencimento, today);
    const base = { id: uid('obl'), profileId: pid, createdAt: new Date().toISOString(), status: 'open', zone: null, beneficiary: nome, balance: valor, principalAmount: valor, totalAmount: valor, dueDate: due, rules: {} };
    if (parcela > 0) Object.assign(base, { installmentAmount: parcela, installmentsLeft: parcelas || Math.ceil(valor / parcela), installmentsTotal: parcelas || Math.ceil(valor / parcela) });
    let kindLabel;
    if (/essencial|fixa|aluguel|luz|agua|vital/.test(t) || (!t && /aluguel|luz|agua|gas|internet|condominio|escola|pensao/.test(norm(nome)))) {
      if (!due) throw new Error(`Qual o vencimento de ${nome}?`);
      Object.assign(base, { type: 'vital_fixed', vitalKind: VITAL_KINDS[a.tipo_essencial] ? a.tipo_essencial : guessVitalKind(nome), bucket: 'casa', recurrence: a.repete === undefined || yes(a.repete) ? 'monthly' : null });
      delete base.installmentAmount; delete base.installmentsLeft; delete base.installmentsTotal;
      kindLabel = `Conta essencial (${VITAL_KINDS[base.vitalKind]})${base.recurrence ? ', todo mês' : ''}`;
    } else if (/pessoa|amigo|familia|mae|pai|parente/.test(t)) {
      Object.assign(base, { type: 'personal_debt', bucket: 'familia' });
      kindLabel = 'Dívida com pessoa';
    } else if (/emprest|financ|credito pessoal/.test(t)) {
      Object.assign(base, { type: 'financing', bucket: 'pessoal', monthlyInterestPercent: num(a.juros_mes), loanTotal: valor });
      kindLabel = 'Empréstimo';
    } else if (/cart/.test(t)) {
      Object.assign(base, { type: 'card_debt', bucket: 'pessoal', beneficiary: /fatura/i.test(nome) ? nome : `Fatura ${nome}`, monthlyInterestPercent: num(a.juros_mes, 14) });
      kindLabel = 'Dívida de cartão';
    } else {
      Object.assign(base, {
        type: 'boleto', bucket: 'pessoal',
        rules: { finePercent: 2, dailyInterestPercent: 0.033, canProtest: Boolean(due), protestDeadline: due ? addDays(due, 5) : null, estimatedProtestFee: 210 },
      });
      kindLabel = 'Boleto';
    }
    const ob = normalizeObligation(base);
    return {
      preview: {
        title: 'Cadastrar',
        lines: [`${ob.beneficiary} · ${kindLabel}`, `${brl(valor)}${parcela > 0 ? ` em ${ob.installmentsLeft}x de ${brl(parcela)}` : ''}${due ? ` · vence ${dateHuman(due)}` : ''}`,
          ob.monthlyInterestPercent ? `Juros: ${ob.monthlyInterestPercent}% ao mês` : null].filter(Boolean),
      },
      execute: async () => {
        const act = await api.commit({ obligations: [ob] }, { label: `Cadastro: ${ob.beneficiary}` });
        return { text: `Cadastrado: ${ob.beneficiary}. Já entrou na ordem de pagamento.`, actionId: act?.id };
      },
    };
  });

  def('cadastrar_conta', 'write', 'Cadastra conta bancária (Pix), vale/benefício ou cartão de crédito.', {
    nome: 'ex.: Nubank, Caju', tipo: 'pix | vale | credito', saldo: 'saldo atual (opcional)', uso: 'para vale: alimentacao | transporte (opcional)', limite: 'para crédito (opcional)',
  }, (a = {}) => {
    const { pid } = ctx();
    const nome = String(a.nome || '').trim();
    if (!nome) throw new Error('Qual o nome da conta?');
    const t = norm(a.tipo);
    const type = /vale|benef|alimenta|refei|transporte/.test(t) ? 'benefit_card' : /credito|cartao/.test(t) ? 'credit_card' : 'checking_cash';
    const acc = normalizeAccount({
      id: uid('acc'), profileId: pid, name: nome, type, balance: money(a.saldo) || 0,
      lock: /transporte/.test(norm(`${a.uso} ${a.tipo}`)) ? 'transporte' : 'alimentacao',
      limitTotal: money(a.limite) || 0, limitAvailable: money(a.limite) || 0,
    });
    return {
      preview: { title: 'Cadastrar conta', lines: [`${acc.name} · ${ACCOUNT_TYPES[type].label}`, type === 'credit_card' ? `Limite ${brl(acc.limitTotal)}` : `Saldo ${brl(acc.balance)}`] },
      execute: async () => {
        const act = await api.commit({ accounts: [acc] }, { label: `Conta: ${acc.name}` });
        return { text: `Conta ${acc.name} cadastrada.`, actionId: act?.id };
      },
    };
  });

  def('desfazer', 'write', 'Desfaz a última ação feita no app (ou a de um número de "ultimas_acoes").', { qual: 'número da lista de últimas ações (opcional, padrão 1)' }, (a = {}) => {
    const { state } = ctx();
    const j = api.journal() || [];
    const n = Math.max(1, Math.round(num(a.qual, 1)));
    const action = j[n - 1];
    if (!action) throw new Error('Não há ação para desfazer.');
    return {
      preview: { title: 'Desfazer', lines: [action.label, ...describeAction(action, state).slice(0, 5)] },
      execute: async () => {
        await api.undo(action.id);
        return { text: `Desfeito: ${action.label}.` };
      },
    };
  });

  def('criar_peca', 'write', 'Cria uma função nova no app montando uma peça: pote, regra, lembrete, painel ou categoria.', {
    peca: 'pote | regra | lembrete | painel | categoria',
    nome: 'pote/categoria: nome', meta: 'pote: valor da meta (opcional)', prazo: 'pote: data (opcional)',
    pote: 'regra: nome do pote', quando: 'regra: palavra da entrada (ex.: adiantamento)', valor: 'regra: R$ a separar', percentual: 'regra: % a separar',
    texto: 'lembrete: o que lembrar', data: 'lembrete: data', dia_do_mes: 'lembrete mensal: dia', antes_de: 'lembrete: nome da conta', dias: 'lembrete: dias antes',
    titulo: 'painel: título', filtro: 'painel: palavra na descrição', categorias: 'painel: lista (opcional)', periodo: 'painel: mes | 30d | 7d | ano', formula: 'painel: ex.: total / hora', unidade: 'painel: reais | horas | numero',
    direcao: 'categoria/painel: saida | entrada',
  }, (a = {}) => {
    const { state, today, pid } = ctx();
    const piece = norm(a.peca).replace(/\s+/g, '');
    const changes = { recipes: [] };
    let spec;
    const extra = [];
    if (piece === 'pote') spec = { nome: a.nome || a.titulo || a.texto, meta: money(a.meta) || 0, prazo: dateArg(a.prazo, today) };
    else if (piece === 'categoria') spec = { nome: a.nome || a.titulo, direcao: /entrada/.test(norm(a.direcao)) ? 'entrada' : 'saida' };
    else if (piece === 'regra') {
      const pots = recipesOf(state, pid, 'pote');
      const potName = String(a.pote || a.nome || '').trim();
      if (!potName) throw new Error('Em qual pote separar o dinheiro?');
      let pot = pots.length ? matchByName(potName, pots, (p) => p.spec.nome).match : null;
      if (!pot) {
        pot = normalizeRecipe({ piece: 'pote', profileId: pid, createdBy: 'assistente', spec: { nome: potName } });
        changes.recipes.push(pot);
        extra.push(`Cria também o pote "${pot.spec.nome}".`);
      }
      spec = { pote: pot.id, quando: { texto: a.quando || a.texto || '', minimo: money(a.minimo) || 0 }, valor: money(a.valor) || 0, percentual: num(String(a.percentual || '').replace(',', '.').replace('%', '')) };
    } else if (piece === 'lembrete') {
      if (a.antes_de) spec = { texto: a.texto || `Pagar ${a.antes_de}`, tipo: 'antes_vencimento', conta: a.antes_de, dias: num(a.dias, 2) };
      else if (a.dia_do_mes) spec = { texto: a.texto, tipo: 'mensal', dia: num(a.dia_do_mes) };
      else spec = { texto: a.texto, tipo: 'data', data: dateArg(a.data, today) };
    } else if (piece === 'painel') {
      const cats = Array.isArray(a.categorias) ? a.categorias : String(a.categorias || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      spec = {
        titulo: a.titulo || a.nome || a.filtro, direcao: /entrada/.test(norm(a.direcao)) ? 'entrada' : /ambas|saldo/.test(norm(a.direcao)) ? 'ambas' : 'saida',
        texto: a.filtro || '', categorias: cats, periodo: a.periodo || 'mes', formula: a.formula || '', unidade: a.unidade || (/hora/.test(norm(a.formula)) ? 'horas' : 'reais'),
      };
    } else throw new Error('Que tipo de peça? Pote, regra, lembrete, painel ou categoria.');
    const recipe = normalizeRecipe({ piece, profileId: pid, createdBy: 'assistente', spec });
    const v = validateRecipe(recipe, { ...state, recipes: [...state.recipes, ...changes.recipes] }, { pid });
    if (!v.ok) throw new Error(v.errors.join(' '));
    changes.recipes.push(recipe);
    return {
      preview: { title: 'Nova peça', lines: [describeRecipe(recipe, { ...state, recipes: [...state.recipes, ...changes.recipes] }), ...extra], recipe },
      execute: async () => {
        const act = await api.commit(changes, { label: `Nova peça: ${recipe.title}` });
        return { text: `Peça criada: ${recipe.title}.${piece === 'pote' || piece === 'painel' ? ' Já aparece na tela inicial.' : ''}`, actionId: act?.id, recipe };
      },
    };
  });

  def('guardar_no_pote', 'write', 'Guarda (ou tira) dinheiro de um pote.', { pote: 'nome do pote', valor: 'número', tirar: 'sim para tirar (opcional)' }, (a = {}) => {
    const { state, pid } = ctx();
    const pot = resolve(String(a.pote || ''), recipesOf(state, pid, 'pote'), (p) => p.spec.nome, 'pote');
    const valor = money(a.valor);
    if (!(valor > 0)) throw new Error('Quanto?');
    const out = yes(a.tirar);
    if (out && valor > pot.state.guardado + 0.01) throw new Error(`O pote ${pot.spec.nome} só tem ${brl(pot.state.guardado)}.`);
    const next = movePot(pot, out ? -valor : valor);
    return {
      preview: { title: out ? 'Tirar do pote' : 'Guardar no pote', lines: [`${pot.spec.nome}: ${brl(pot.state.guardado)} → ${brl(next.state.guardado)}`, 'O dinheiro continua na sua conta; o pote só marca para que ele é.'] },
      execute: async () => {
        const act = await api.commit({ recipes: [next] }, { label: `${out ? 'Tirou' : 'Guardou'} ${brl(valor)} no pote ${pot.spec.nome}` });
        return { text: `Pote ${pot.spec.nome}: ${brl(next.state.guardado)}.`, actionId: act?.id };
      },
    };
  });

  def('desligar_peca', 'write', 'Desliga (ou liga de novo) uma peça.', { peca: 'nome da peça', ligar: 'sim para ligar (opcional)' }, (a = {}) => {
    const { state, pid } = ctx();
    const r = resolve(String(a.peca || ''), recipesOf(state, pid), (x) => `${x.title} ${x.spec.nome || x.spec.titulo || x.spec.texto || ''}`, 'peça');
    const on = yes(a.ligar);
    return {
      preview: { title: on ? 'Ligar peça' : 'Desligar peça', lines: [r.title] },
      execute: async () => {
        const act = await api.commit({ recipes: [{ ...r, enabled: on }] }, { label: `${on ? 'Ligou' : 'Desligou'} a peça: ${r.title}` });
        return { text: `${on ? 'Ligada' : 'Desligada'}: ${r.title}.`, actionId: act?.id };
      },
    };
  });

  def('pedir_funcao', 'write', 'Anota um pedido de função que o app ainda não tem e nenhuma peça resolve.', { descricao: 'o que a pessoa queria' }, (a = {}) => {
    const text = String(a.descricao || '').trim().slice(0, 400);
    if (!text) throw new Error('Qual função você queria?');
    return {
      preview: { title: 'Anotar pedido de função', lines: [text, 'Fica salvo em Ajustes → Pedidos de função. Você decide se envia ao criador do app.'] },
      execute: async () => {
        await api.addRequest(text);
        return { text: 'Pedido anotado. Em Ajustes você pode enviar para o criador do app.' };
      },
    };
  });

  def('abrir', 'ui', 'Abre uma tela do app.', { tela: 'inicio | dinheiro | dividas | futuro | plano | pecas' }, (a = {}) => {
    const map = { inicio: 'hud', dinheiro: 'wallet', dividas: 'battle', futuro: 'vault', plano: 'plan', pecas: 'recipes' };
    const key = Object.keys(map).find((k) => norm(a.tela).includes(k)) || 'inicio';
    return { text: `Abrindo ${key}.`, navigate: map[key] };
  });

  return T;
}

/** Texto curto do catálogo para o modelo (nome(args): descrição). */
export function toolsPrompt(tools) {
  return Object.values(tools).map((t) => {
    const args = Object.entries(t.params).map(([k, v]) => `${k}: ${v}`).join('; ');
    return `- ${t.name}(${args}) — ${t.desc}`;
  }).join('\n');
}

const ALIASES = { value: 'valor', amount: 'valor', quantia: 'valor', name: 'nome', descrição: 'descricao', description: 'descricao', date: 'data', account: 'conta', type: 'tipo' };

/** Roda uma ferramenta com proteção: erros viram { error, options } em português. */
export async function runTool(tools, name, args = {}) {
  const tool = tools[name];
  if (!tool) return { error: `Não existe a ferramenta "${name}".` };
  const clean = {};
  for (const [k, v] of Object.entries(args && typeof args === 'object' ? args : {})) clean[ALIASES[k] || k] = v;
  try {
    const out = await tool.run(clean);
    return { kind: tool.kind, ...out };
  } catch (err) {
    return { kind: tool.kind, error: err.message || String(err), options: err.options || null, query: err.query ?? null };
  }
}

export { FORMULA_VARS };
