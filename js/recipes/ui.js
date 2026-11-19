// Telas das peças: cartões na tela inicial, lista para gerenciar e criação passo a passo (sem IA).

import { store } from '../store.js';
import { esc, openSheet, confirmSheet, toast, haptic, formData, bindSegments } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { brl, dateHuman, parseMoney, lifeTime } from '../core/format.js';
import { round2, num } from '../core/util.js';
import { addDays } from '../core/dates.js';
import {
  PIECES, PERIODS, UNITS, FORMULA_VARS, normalizeRecipe, validateRecipe, describeRecipe, computePanel, dueReminders,
  markReminderDone, movePot, recipesOf,
} from './model.js';

const DEFAULT_CATS = ['mercado', 'transporte', 'casa', 'saúde', 'trabalho', 'lazer', 'pagamento', 'outros', 'salário', 'adiantamento', 'extra', 'venda'];
const seg = (name, options, value) => `
  <input type="hidden" name="${name}" value="${esc(value)}">
  <div class="seg" data-name="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;

export function panelContext(d) {
  const debts = [...d.tri.frontline, ...d.tri.battlefield, ...d.tri.quarantine].filter((i) => !i.isVital);
  return { caixa: d.cash, hora: d.rate, essenciais: d.wl.floor, dividas: round2(debts.reduce((s, i) => s + i.updated, 0)) };
}

function panelDisplay(r, out) {
  if (out.error) return `<span class="c-magenta small">${esc(out.error)}</span>`;
  const v = out.value;
  if (r.spec.unidade === 'horas') return esc(lifeTime(v * 60));
  if (r.spec.unidade === 'numero' || r.spec.unidade === 'dias') return `${String(round2(v)).replace('.', ',')}${r.spec.unidade === 'dias' ? ' dias' : ''}`;
  return brl(v);
}

/** Cartão de uma peça (usado na tela inicial e nas prévias). */
export function recipeCardHTML(r, d, { preview = false } = {}) {
  const s = r.spec;
  const act = (a, extra = '') => (preview ? '' : `data-act="${a}" data-id="${esc(r.id)}"${extra}`);
  if (r.piece === 'pote') {
    const g = num(r.state.guardado);
    const pct = s.meta > 0 ? Math.min(100, (g / s.meta) * 100) : 0;
    return `<div class="card tight piece pot">
      <div class="row between"><span class="eyebrow">${icon('jar')} ${esc(s.nome)}</span>${s.prazo ? `<span class="tiny">até ${esc(dateHuman(s.prazo))}</span>` : ''}</div>
      <div class="row between" style="margin-top:6px"><b class="num">${brl(g)}</b>${s.meta ? `<span class="tiny">de ${brl(s.meta)}</span>` : ''}</div>
      ${s.meta ? `<div class="meter" style="margin:8px 0"><i style="width:${pct}%"></i></div>` : ''}
      ${preview ? '' : `<div class="row" style="gap:8px;margin-top:6px"><button class="btn sm" ${act('pot-in')}>${icon('plus')}Guardar</button><button class="btn sm ghost" ${act('pot-out')}>Tirar</button></div>`}
    </div>`;
  }
  if (r.piece === 'painel') {
    const out = computePanel(store.state, d.pid, r, d.today, panelContext(d));
    return `<${preview ? 'div' : 'button type="button"'} class="card tight piece panel${preview ? '' : ' tap'}" ${act('panel-open')}>
      <span class="eyebrow">${icon('gauge')} ${esc(s.titulo)}</span>
      <div class="mid num" style="margin-top:4px">${panelDisplay(r, out)}</div>
      <div class="tiny">${out.vezes} ${out.vezes === 1 ? 'lançamento' : 'lançamentos'} · ${esc(PERIODS[s.periodo])}${s.unidade === 'horas' ? ` · ${brl(out.total)}` : ''}</div>
    </${preview ? 'div' : 'button'}>`;
  }
  if (r.piece === 'lembrete') {
    return `<div class="card tight piece"><span class="eyebrow">${icon('bell')} Lembrete</span><div class="small" style="margin-top:6px">${esc(describeRecipe(r, store.state))}</div></div>`;
  }
  return `<div class="card tight piece"><span class="eyebrow">${icon('puzzle')} ${esc(PIECES[r.piece].label)}</span><div class="small" style="margin-top:6px">${esc(describeRecipe(r, store.state))}</div></div>`;
}

/** Lembretes de hoje + potes + painéis para a tela inicial. */
export function recipesHUDHTML(d) {
  const mine = recipesOf(store.state, d.pid).filter((r) => r.enabled);
  const due = dueReminders(store.state, d.pid, d.today);
  const reminders = due.map((x) => `<div class="alert info reminder">${icon('bell')}<div class="grow"><b>${esc(x.text)}</b>
      ${x.obligation ? `<div class="tiny">${esc(x.obligation.beneficiary)} vence ${esc(dateHuman(x.obligation.dueDate))}</div>` : ''}</div>
      <button class="btn sm" data-act="reminder-done" data-id="${esc(x.recipe.id)}" data-key="${esc(x.key)}">Feito</button></div>`).join('');
  const visual = mine.filter((r) => r.piece === 'pote' || r.piece === 'painel');
  const grid = visual.length ? `<div class="section-title"><h2>Suas peças</h2><button class="btn sm ghost" data-act="recipes">${icon('puzzle')}Gerenciar</button></div>
    <div class="pieces-grid">${visual.map((r) => recipeCardHTML(r, d)).join('')}</div>` : '';
  return { reminders, grid, hasAny: mine.length > 0 };
}

// ---------------------------------------------------------------- ações simples

async function commitRecipe(rec, label) {
  await store.commit({ recipes: [rec] }, { label });
}

export async function reminderDone(id, key) {
  const r = store.state.recipes.find((x) => x.id === id);
  if (!r) return;
  await commitRecipe(markReminderDone(r, key), `Lembrete feito: ${r.spec.texto}`);
}

export function openPotMove(id, dir) {
  const r = store.state.recipes.find((x) => x.id === id);
  if (!r) return;
  const out = dir === 'out';
  openSheet({
    title: out ? `Tirar do pote ${r.spec.nome}` : `Guardar no pote ${r.spec.nome}`,
    body: `<form novalidate class="stack">
      <p class="small">${out ? 'Tira a marcação do pote.' : 'Marca parte do seu dinheiro para este objetivo.'} O dinheiro continua na sua conta.</p>
      <label class="field"><span>Quanto</span><input class="input money" name="v" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
      <div class="tiny">No pote agora: ${brl(r.state.guardado)}${r.spec.meta ? ` · meta ${brl(r.spec.meta)}` : ''}</div>
      <button class="btn primary block" type="submit">${out ? 'Tirar' : 'Guardar'}</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = parseMoney(form.v.value);
        if (v <= 0) { toast('Informe o valor.', { tone: 'magenta' }); return; }
        if (out && v > r.state.guardado + 0.01) { toast(`O pote só tem ${brl(r.state.guardado)}.`, { tone: 'magenta' }); return; }
        await commitRecipe(movePot(r, out ? -v : v), `${out ? 'Tirou' : 'Guardou'} ${brl(v)} no pote ${r.spec.nome}`);
        close();
        haptic();
      };
    },
  });
}

export function openPanelDetail(id) {
  const r = store.state.recipes.find((x) => x.id === id);
  const d = store.derive();
  if (!r || !d) return;
  const out = computePanel(store.state, d.pid, r, d.today, panelContext(d));
  openSheet({
    title: r.spec.titulo,
    body: `<div class="stack">
      <div class="mid num">${panelDisplay(r, out)}</div>
      <p class="small">${esc(describeRecipe(r, store.state))}</p>
      <div class="ledger-list">${out.entries.slice(-30).reverse().map((e) => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <span>${esc(dateHuman(e.date))} · ${esc(e.note || e.category)}</span><span class="num">${brl(e.amount)}</span></div>`).join('') || '<div class="empty">Nada no período.</div>'}</div>
    </div>`,
  });
}

// ---------------------------------------------------------------- gerenciar

export function openRecipesSheet() {
  const pid = store.pid;
  const list = recipesOf(store.state, pid);
  openSheet({
    title: 'Peças do seu app',
    body: `<div class="stack">
      <p class="small">Peças são funções que você monta sem programar: potes, regras, lembretes, painéis e categorias. O assistente também monta peças quando você pede.</p>
      ${list.map((r) => `<div class="card tight stack" style="gap:6px">
        <div class="row between"><b class="small">${icon(r.piece === 'pote' ? 'jar' : r.piece === 'lembrete' ? 'bell' : r.piece === 'painel' ? 'gauge' : 'puzzle')} ${esc(r.title)}</b>
          <span class="tiny">${r.createdBy === 'assistente' ? 'pelo assistente' : 'por você'}</span></div>
        <div class="tiny">${esc(describeRecipe(r, store.state))}</div>
        <div class="row" style="gap:8px">
          <button class="btn sm" type="button" data-toggle="${esc(r.id)}">${r.enabled ? 'Desligar' : 'Ligar'}</button>
          <button class="btn sm ghost" type="button" data-del="${esc(r.id)}">${icon('trash')}Apagar</button></div>
      </div>`).join('') || '<div class="empty">Nenhuma peça ainda.</div>'}
      <button class="btn primary block" type="button" data-new>${icon('plus')}Criar peça</button>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-new]').onclick = () => { close(); openRecipeCreator(); };
      el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
        const r = store.state.recipes.find((x) => x.id === b.dataset.toggle);
        close();
        await commitRecipe({ ...r, enabled: !r.enabled }, `${r.enabled ? 'Desligou' : 'Ligou'} a peça: ${r.title}`);
      }));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const r = store.state.recipes.find((x) => x.id === b.dataset.del);
        close();
        const deps = store.state.recipes.filter((x) => x.piece === 'regra' && x.spec.pote === r.id);
        if (await confirmSheet({ title: 'Apagar peça?', text: `${esc(r.title)}${deps.length ? `<br>As ${deps.length} regra(s) que usam este pote também serão apagadas.` : ''}<br>Dá para desfazer depois.`, confirmLabel: 'Apagar', danger: true })) {
          await store.commit({ removeRecipes: [r.id, ...deps.map((x) => x.id)] }, { label: `Apagou a peça: ${r.title}` });
        }
      }));
    },
  });
}

// ---------------------------------------------------------------- criar (sem IA)

function formFor(piece, d) {
  const pid = d.pid;
  const pots = recipesOf(store.state, pid, 'pote');
  const obs = store.state.obligations.filter((o) => o.status !== 'paid' && (o.profileId === pid || o.isShared));
  const cats = [...new Set([...DEFAULT_CATS, ...recipesOf(store.state, pid, 'categoria').map((r) => r.spec.nome)])];
  switch (piece) {
    case 'categoria':
      return `<label class="field"><span>Nome</span><input class="input" name="nome" maxlength="30" placeholder="Ex.: ração, gorjeta, feira"></label>
        <label class="field"><span>É de</span>${seg('direcao', [['saida', 'Gasto'], ['entrada', 'Entrada']], 'saida')}</label>`;
    case 'pote':
      return `<label class="field"><span>Para quê</span><input class="input" name="nome" maxlength="40" placeholder="Ex.: Gás, Material escolar, Reserva"></label>
        <div class="grid-2"><label class="field"><span>Meta (opcional)</span><input class="input" name="meta" inputmode="decimal" placeholder="0,00"></label>
        <label class="field"><span>Até quando (opcional)</span><input class="input" type="date" name="prazo"></label></div>`;
    case 'regra':
      return `${pots.length ? `<label class="field"><span>Separar no pote</span><select class="input" name="pote">${pots.map((p) => `<option value="${esc(p.id)}">${esc(p.spec.nome)}</option>`).join('')}<option value="__novo">+ Pote novo</option></select></label>` : '<input type="hidden" name="pote" value="__novo">'}
        <label class="field" data-novo-pote${pots.length ? ' hidden' : ''}><span>Nome do pote novo</span><input class="input" name="novoPote" placeholder="Ex.: Ração"></label>
        <label class="field"><span>Quando entrar dinheiro com este nome</span><input class="input" name="texto" placeholder="Ex.: adiantamento, salário, venda"></label>
        <div class="grid-2"><label class="field"><span>Separar (R$)</span><input class="input" name="valor" inputmode="decimal" placeholder="Ex.: 50"></label>
        <label class="field"><span>ou (%)</span><input class="input" name="percentual" inputmode="decimal" placeholder="Ex.: 10"></label></div>
        <label class="field"><span>Só se for pelo menos (opcional)</span><input class="input" name="minimo" inputmode="decimal" placeholder="0,00"></label>`;
    case 'lembrete':
      return `<label class="field"><span>O que lembrar</span><input class="input" name="texto" maxlength="120" placeholder="Ex.: Ligar pro banco e pedir desconto"></label>
        <label class="field"><span>Quando</span>${seg('tipo', [['data', 'Numa data'], ['mensal', 'Todo mês'], ['antes_vencimento', 'Antes de vencer']], 'data')}</label>
        <div data-t="data"><label class="field"><span>Data</span><input class="input" type="date" name="data" value="${addDays(d.today, 1)}"></label></div>
        <div data-t="mensal" hidden><label class="field"><span>Dia do mês</span><input class="input" type="number" name="dia" min="1" max="31" value="5"></label></div>
        <div data-t="antes_vencimento" hidden class="grid-2">
          <label class="field"><span>Conta</span><select class="input" name="conta">${[...new Set(obs.map((o) => o.beneficiary))].map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
          <label class="field"><span>Dias antes</span><input class="input" type="number" name="dias" min="0" max="30" value="2"></label></div>
        <p class="tiny">O lembrete aparece na tela inicial. Com o app instalado e notificações liberadas, o celular também avisa quando possível.</p>`;
    case 'painel':
      return `<label class="field"><span>Título</span><input class="input" name="titulo" maxlength="40" placeholder="Ex.: Uber no mês"></label>
        <label class="field"><span>Somar</span>${seg('direcao', [['saida', 'Gastos'], ['entrada', 'Entradas'], ['ambas', 'Entradas − gastos']], 'saida')}</label>
        <label class="field"><span>Que tenham na descrição (opcional)</span><input class="input" name="texto" placeholder="Ex.: uber, ifood"></label>
        <label class="field"><span>Das categorias (opcional)</span><div class="row wrap" style="gap:6px">${cats.map((c) => `<label class="chip-check"><input type="checkbox" name="cat_${esc(c)}"><span>${esc(c)}</span></label>`).join('')}</div></label>
        <div class="grid-2"><label class="field"><span>Período</span><select class="input" name="periodo">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Mostrar em</span><select class="input" name="unidade">${Object.entries(UNITS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
        <details><summary class="small" style="cursor:pointer">Fórmula (opcional)</summary><div class="stack" style="margin-top:8px">
          <input class="input" name="formula" placeholder="Ex.: total / hora" autocomplete="off">
          <div class="row wrap" style="gap:6px">${Object.entries(FORMULA_VARS).map(([k, l]) => `<button type="button" class="btn sm ghost" data-var="${k}" title="${esc(l)}">${k}</button>`).join('')}</div>
          <p class="tiny">Só contas: + − * / e parênteses. "total / hora" mostra quantas horas de trabalho o gasto custou (escolha "horas de trabalho").</p></div></details>`;
    default: return '';
  }
}

function specFrom(piece, v) {
  switch (piece) {
    case 'categoria': return { nome: v.nome, direcao: v.direcao };
    case 'pote': return { nome: v.nome, meta: parseMoney(v.meta), prazo: v.prazo || null };
    case 'regra': return { pote: v.pote, quando: { texto: v.texto, minimo: parseMoney(v.minimo) }, valor: parseMoney(v.valor), percentual: parseMoney(v.percentual) };
    case 'lembrete': return { texto: v.texto, tipo: v.tipo, data: v.data, dia: num(v.dia), conta: v.conta, dias: num(v.dias) };
    case 'painel': return {
      titulo: v.titulo, direcao: v.direcao, texto: v.texto, periodo: v.periodo, unidade: v.unidade, formula: v.formula,
      categorias: Object.keys(v).filter((k) => k.startsWith('cat_') && v[k]).map((k) => k.slice(4)),
    };
    default: return {};
  }
}

export function openRecipeCreator(piece = null) {
  const d = store.derive();
  if (!d) return;
  if (!piece) {
    openSheet({
      title: 'Criar peça',
      body: `<div class="stack">${Object.entries(PIECES).map(([k, p]) => `<button class="card tight tap" type="button" data-p="${k}" style="text-align:left;color:inherit;width:100%">
        <b>${esc(p.label)}</b><div class="tiny">${esc(p.hint)}</div></button>`).join('')}
        <p class="tiny">Dica: no assistente é só pedir, tipo "cria um pote de 300 pro gás até dia 10".</p></div>`,
      onMount(el, close) {
        el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { close(); openRecipeCreator(b.dataset.p); }));
      },
    });
    return;
  }
  openSheet({
    title: `Nova peça: ${PIECES[piece].label}`,
    body: `<form novalidate class="stack">${formFor(piece, d)}
      <div class="stack" data-preview></div>
      <button class="btn primary block" type="submit">${icon('check')}Ativar peça</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      const prev = el.querySelector('[data-preview]');
      const build = () => {
        const v = formData(form);
        return normalizeRecipe({ piece, profileId: d.pid, spec: specFrom(piece, v), createdBy: 'voce' });
      };
      const sync = () => {
        const v = formData(form);
        if (piece === 'lembrete') for (const box of el.querySelectorAll('[data-t]')) box.hidden = box.dataset.t !== v.tipo;
        if (piece === 'regra') { const nb = el.querySelector('[data-novo-pote]'); if (nb) nb.hidden = v.pote !== '__novo'; }
        const r = build();
        const val = validateRecipe(piece === 'regra' && v.pote === '__novo' ? { ...r, spec: { ...r.spec, pote: '__tmp' } } : r, piece === 'regra' && v.pote === '__novo'
          ? { ...store.state, recipes: [...store.state.recipes, normalizeRecipe({ id: '__tmp', piece: 'pote', profileId: d.pid, spec: { nome: v.novoPote || 'novo' } })] } : store.state, { pid: d.pid });
        prev.innerHTML = `<span class="eyebrow">Assim vai ficar</span>${recipeCardHTML(r, d, { preview: true })}
          <p class="tiny">${esc(describeRecipe(r, store.state))}</p>
          ${val.ok ? '' : `<div class="tiny c-magenta">${val.errors.map(esc).join('<br>')}</div>`}`;
        return val;
      };
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      el.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
        form.formula.value = `${form.formula.value}${form.formula.value && !/\s$/.test(form.formula.value) ? ' ' : ''}${b.dataset.var}`;
        sync();
      }));
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const changes = { recipes: [] };
        let r = build();
        if (piece === 'regra' && v.pote === '__novo') {
          if (!v.novoPote?.trim()) { toast('Dê um nome ao pote novo.', { tone: 'magenta' }); return; }
          const pot = normalizeRecipe({ piece: 'pote', profileId: d.pid, spec: { nome: v.novoPote } });
          changes.recipes.push(pot);
          r = normalizeRecipe({ ...r, spec: { ...r.spec, pote: pot.id } });
        }
        const val = validateRecipe(r, { ...store.state, recipes: [...store.state.recipes, ...changes.recipes] }, { pid: d.pid });
        if (!val.ok) { toast(esc(val.errors[0]), { tone: 'magenta' }); return; }
        changes.recipes.push(r);
        await store.commit(changes, { label: `Nova peça: ${r.title}` });
        close();
        haptic();
        if (piece === 'lembrete') maybeAskNotifications();
      };
    },
  });
}

/** Lembretes com o app fechado: pede permissão e registra a checagem periódica (quando o celular permitir). */
export async function maybeAskNotifications() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.periodicSync) {
      const status = await navigator.permissions?.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (!status || status.state === 'granted') await reg.periodicSync.register('jornada-lembretes', { minInterval: 6 * 60 * 60 * 1000 });
    }
  } catch { /* opcional: o lembrete sempre aparece na tela inicial */ }
}
