// Assistente: conversa que usa o app sozinha. IA no aparelho (Gemma) quando disponível; modo básico sempre.
// Toda mudança aparece como prévia e só acontece quando a pessoa toca em "Confirmar". Tudo tem desfazer.

import { store } from '../store.js';
import { esc, toast, haptic, celebrate } from './dom.js';
import { icon } from './icons.js';
import { brl, dateHuman } from '../core/format.js';
import { parseMoneyBR, parseDateBR } from '../core/text.js';
import { createTools, runTool } from '../agent/tools.js';
import { parseBasic, HELP } from '../agent/basic.js';
import { agentTurn, buildSystemPrompt, snapshotLine } from '../agent/protocol.js';
import { pendingForecasts } from '../engines/forecast.js';
import { recipeCardHTML, maybeAskNotifications } from '../recipes/ui.js';
import * as AI from '../agent/llm.js';

let hooks = { goto: () => {}, openPlan: () => {}, openRecipes: () => {} };
let panel = null;
let logEl = null;
let inputEl = null;
let busy = false;
let chat = null;
let pendingNote = '';
let lastAsk = null;
let abort = null;
const ai = { status: 'idle', support: null, loaded: 0, total: null, error: '' };

const api = {
  state: () => store.state,
  today: () => store.today,
  derive: () => store.derive(),
  btcPrice: () => store.btcPrice(),
  journal: () => store.meta.journal || [],
  commit: (changes, opts) => store.commit(changes, opts),
  undo: (id) => store.undo(id),
  addRequest: async (text) => {
    const list = store.meta.requests || [];
    await store.setMeta('requests', [{ id: `req_${Date.now()}`, text, at: new Date().toISOString(), sent: false }, ...list].slice(0, 50));
  },
};
const tools = createTools(api);

export function initAssistant(h) {
  hooks = { ...hooks, ...h };
}

// ---------------------------------------------------------------- painel

const SUGGESTIONS = ['Como estou?', 'O que faço agora?', 'Caiu meu salário', 'Paguei a luz', 'Gastei 30 no uber', 'Como distribuir o que vai entrar?', 'Cria um pote de 300 pro gás', 'Me lembra de ligar pro banco sexta'];

function build() {
  panel = document.createElement('section');
  panel.className = 'as-panel';
  panel.id = 'assistant';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Assistente');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="as-head">
      <button class="icon-btn" type="button" data-as="close" aria-label="Voltar">${icon('back')}</button>
      <div class="grow"><b>Assistente</b><div class="tiny" data-as="status"></div></div>
      <button class="icon-btn" type="button" data-as="clear" aria-label="Limpar conversa" title="Limpar conversa">${icon('trash')}</button>
    </header>
    <div class="as-log" data-as="log" aria-live="polite"></div>
    <div class="as-chips" data-as="chips">${SUGGESTIONS.map((s) => `<button type="button" class="chip-btn">${esc(s)}</button>`).join('')}</div>
    <form class="as-input" data-as="form">
      <textarea rows="1" maxlength="600" placeholder="Escreva (ou use o microfone do teclado)" aria-label="Mensagem" enterkeyhint="send"></textarea>
      <button class="btn primary" type="submit" aria-label="Enviar">${icon('send')}</button>
    </form>`;
  document.body.appendChild(panel);
  logEl = panel.querySelector('[data-as="log"]');
  inputEl = panel.querySelector('textarea');
  panel.querySelector('[data-as="close"]').onclick = closeAssistant;
  panel.querySelector('[data-as="clear"]').onclick = clearChat;
  panel.querySelector('[data-as="chips"]').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-btn');
    if (b) send(b.textContent);
  });
  panel.querySelector('[data-as="form"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    autosize();
    send(text);
  });
  inputEl.addEventListener('input', autosize);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      panel.querySelector('[data-as="form"]').requestSubmit();
    }
  });
  logEl.addEventListener('click', onLogClick);
  window.addEventListener('popstate', () => { if (!panel.hidden) closeAssistant(true); });
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(120, inputEl.scrollHeight)}px`;
}

export function openAssistant(prefill = '') {
  if (!panel) build();
  if (!panel.hidden) return;
  panel.hidden = false;
  document.body.classList.add('as-open');
  document.querySelectorAll('#toasts .toast').forEach((t) => t.remove());
  try { history.pushState({ assistant: true }, ''); } catch { /* ignore */ }
  requestAnimationFrame(() => panel.classList.add('open'));
  if (!logEl.children.length) greet();
  renderSetup();
  refreshAI();
  if (prefill) send(prefill);
  else setTimeout(() => inputEl.focus({ preventScroll: true }), 250);
}

export function closeAssistant(fromHistory = false) {
  if (!panel || panel.hidden) return;
  panel.classList.remove('open');
  document.body.classList.remove('as-open');
  setTimeout(() => { panel.hidden = true; }, 220);
  if (!fromHistory) { try { if (history.state?.assistant) history.back(); } catch { /* ignore */ } }
}

export const assistantOpen = () => Boolean(panel && !panel.hidden);

/** Recado do app dentro da conversa (ex.: regra que separou dinheiro num pote). */
export function assistantNote(text) {
  if (assistantOpen()) addBubble('assistant', text);
}

function clearChat() {
  logEl.innerHTML = '';
  pendingNote = '';
  lastAsk = null;
  chat?.reset?.().catch(() => {});
  greet();
  renderSetup();
}

function greet() {
  const name = store.profile?.name ? `, ${store.profile.name.split(' ')[0]}` : '';
  addBubble('assistant', `Oi${name}! Me conta o que aconteceu com o seu dinheiro ou pergunte o que fazer. Eu uso o app por você e sempre te mostro antes de mudar qualquer coisa.`);
}

// ---------------------------------------------------------------- mensagens

function scroll() {
  requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
}

function textHTML(t) {
  return esc(t).replace(/\n/g, '<br>');
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = `as-msg ${role}`;
  el.innerHTML = textHTML(text);
  logEl.appendChild(el);
  scroll();
  return el;
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'as-msg assistant typing';
  el.innerHTML = '<i></i><i></i><i></i>';
  logEl.appendChild(el);
  scroll();
  return el;
}

function addToolLine(name, text) {
  const el = document.createElement('details');
  el.className = 'as-tool';
  el.innerHTML = `<summary>${icon('info')} consultei: ${esc(name.replace(/_/g, ' '))}</summary><div>${textHTML(text)}</div>`;
  logEl.appendChild(el);
  scroll();
}

function addAsk(ev) {
  lastAsk = ev;
  const el = addBubble('assistant', ev.text);
  if (ev.options?.length) {
    const row = document.createElement('div');
    row.className = 'as-options';
    row.innerHTML = ev.options.slice(0, 6).map((o) => `<button type="button" class="chip-btn" data-opt="${esc(o)}">${esc(o)}</button>`).join('');
    el.after(row);
    row.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-opt]');
      if (!b || busy) return;
      row.remove();
      addBubble('user', b.dataset.opt);
      const args = { ...ev.args };
      const key = Object.keys(args).find((k) => String(args[k]) === String(ev.query)) || guessArgKey(ev.tool);
      args[key] = b.dataset.opt;
      lastAsk = null;
      await runAndShow(ev.tool, args);
    });
    scroll();
  }
}

function guessArgKey(tool) {
  return { pagar: 'conta', guardar_no_pote: 'pote', desligar_peca: 'peca', registrar_entrada: 'conta', registrar_gasto: 'conta' }[tool] || 'nome';
}

/** Resposta curta a uma pergunta do assistente ("Quanto entrou?" → "840"). */
function followUp(ask, text) {
  if (!ask || ask.options?.length) return null;
  const args = { ...ask.args };
  const q = ask.text;
  const v = parseMoneyBR(text);
  const d = parseDateBR(text, store.today);
  if (/^Quanto/i.test(q) && v) args[ask.tool === 'criar_peca' ? 'valor' : 'valor'] = v;
  else if (/dia|data|vencimento/i.test(q) && d) args[ask.tool === 'cadastrar_divida' ? 'vencimento' : 'data'] = d;
  else if (/^Qual (o nome|conta você|função)|^Em qual pote|^Que tipo de peça/i.test(q) && text.length < 80) {
    const key = /pote/i.test(q) ? 'pote' : /conta você/i.test(q) ? 'conta' : /função/i.test(q) ? 'descricao' : /tipo de peça/i.test(q) ? 'peca' : 'nome';
    args[key] = text;
  } else return null;
  return { tool: ask.tool, args };
}

function addPreview(toolName, result) {
  const p = result.preview;
  const d = store.derive();
  const card = document.createElement('div');
  card.className = 'as-card';
  card.innerHTML = `<span class="eyebrow">Confere antes de eu fazer</span>
    <b>${esc(p.title)}</b>
    <ul>${p.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${p.recipe && d ? `<div class="as-recipe">${recipeCardHTML(p.recipe, d, { preview: true })}</div>` : ''}
    ${p.warn ? `<div class="alert warn">${icon('alert')}<div>${esc(p.warn)}</div></div>` : ''}
    <div class="row" data-btns style="gap:8px;margin-top:4px">
      <button class="btn primary" type="button" data-ok>${icon('check')}Confirmar</button>
      <button class="btn ghost" type="button" data-no>Cancelar</button></div>`;
  logEl.appendChild(card);
  scroll();
  const btns = card.querySelector('[data-btns]');
  card.querySelector('[data-ok]').onclick = async () => {
    btns.innerHTML = '<span class="tiny">Fazendo…</span>';
    try {
      const out = await result.execute();
      haptic(out.celebrate ? [18, 40, 18, 40, 60] : 12);
      btns.innerHTML = `<span class="small c-cyan">${icon('check')} ${esc(out.text)}</span>${out.actionId ? '<button class="btn sm ghost" type="button" data-undo>Desfazer</button>' : ''}`;
      pendingNote = `[A pessoa confirmou "${p.title}": ${p.lines[0]}. Feito.]`;
      const undo = btns.querySelector('[data-undo]');
      if (undo) {
        undo.onclick = async () => {
          try {
            await store.undo(out.actionId);
            btns.innerHTML = '<span class="small">Desfeito. Tudo voltou como era.</span>';
            pendingNote = `[A pessoa desfez "${p.title}".]`;
          } catch (err) { toast(esc(err.message), { tone: 'magenta' }); }
        };
      }
      if (out.celebrate) celebrate({ title: 'Dívida quitada!', big: '−1', sub: esc(p.lines[0]) });
      if (toolName === 'pedir_funcao') hooks.onRequest?.();
      if (out.recipe?.piece === 'lembrete') maybeAskNotifications();
    } catch (err) {
      btns.innerHTML = `<span class="small c-magenta">${esc(err.message || 'Não deu certo.')}</span>`;
    }
    scroll();
  };
  card.querySelector('[data-no]').onclick = () => {
    btns.innerHTML = '<span class="tiny">Cancelado. Nada mudou.</span>';
    pendingNote = `[A pessoa cancelou "${p.title}".]`;
  };
}

function onLogClick(e) {
  const b = e.target.closest('[data-as-act]');
  if (!b) return;
  const a = b.dataset.asAct;
  if (a === 'download') startDownload();
  if (a === 'pause') AI.pauseDownload();
  if (a === 'load') loadAI();
  if (a === 'redownload') AI.deleteModel().then(() => { ai.status = 'absent'; renderSetup(); startDownload(); });
  if (a === 'help') addBubble('assistant', HELP);
  if (a === 'isolate') {
    try { localStorage.setItem(AI.ISOLATE_KEY, '1'); } catch { /* ignore */ }
    location.replace(`./?isolar=1&action=assistente${location.hash}`);
  }
}

// ---------------------------------------------------------------- execução

async function runAndShow(toolName, args, fallback = null) {
  let result = await runTool(tools, toolName, args);
  if (result.error && fallback) {
    const alt = await runTool(tools, fallback.tool, fallback.args);
    if (!alt.error) { toolName = fallback.tool; result = alt; }
  }
  if (result.error) { addAsk({ tool: toolName, args, text: result.error, options: result.options, query: result.query }); return; }
  if (result.kind === 'write') { addPreview(toolName, result); return; }
  if (result.kind === 'ui') { navigate(result.navigate); return; }
  addBubble('assistant', result.text);
}

function navigate(to) {
  if (to === 'plan') { hooks.openPlan(); return; }
  if (to === 'recipes') { hooks.openRecipes(); return; }
  closeAssistant();
  setTimeout(() => hooks.goto(to), 60);
}

function snapshot() {
  const d = store.derive();
  if (!d) return '';
  const next = pendingForecasts(store.state, d.pid).find((e) => e.liquidity !== 'locked');
  return snapshotLine({
    todayLabel: dateHuman(d.today),
    cash: { value: d.cash, text: brl(d.cash) },
    floor: { value: d.wl.floor, text: brl(d.wl.floor) },
    nextIncome: next ? `${next.note} ${brl(next.amount)} em ${dateHuman(next.date)}` : '',
  });
}

async function send(text) {
  if (busy) return;
  if (!store.state.profiles.length) { toast('Complete o cadastro inicial primeiro.'); return; }
  busy = true;
  setSending(true);
  addBubble('user', text);
  try {
    const fu = followUp(lastAsk, text);
    lastAsk = null;
    if (fu) { await runAndShow(fu.tool, fu.args); return; }
    if (ai.status === 'loading') {
      const typing = addTyping();
      try { await loadAI(); } catch { /* cai no básico */ }
      typing.remove();
    }
    if (ai.status === 'ready' && chat) await aiTurn(text);
    else {
      const r = parseBasic(text, store.today);
      if (r.reply) addBubble('assistant', r.reply);
      else await runAndShow(r.tool, r.args, r.fallback);
    }
  } catch (err) {
    addBubble('assistant', `Algo deu errado: ${err.message || err}. Tente de novo.`);
  } finally {
    busy = false;
    setSending(false);
  }
}

async function aiTurn(text) {
  let bubble = null;
  let typing = addTyping();
  abort = new AbortController();
  const message = `${pendingNote ? `${pendingNote}\n` : ''}${snapshot()}\n${text}`;
  pendingNote = '';
  const started = performance.now();
  try {
    await agentTurn({
      llm: chat, tools, message, signal: abort.signal,
      onEvent: (ev) => {
        if (ev.type === 'thinking') return;
        if (typing && ev.type !== 'text') { typing.remove(); typing = null; }
        if (ev.type === 'text') {
          if (!ev.text) return;
          if (typing) { typing.remove(); typing = null; }
          if (!bubble) bubble = addBubble('assistant', '');
          bubble.innerHTML = textHTML(ev.text);
          scroll();
          if (!ev.partial) bubble = null;
        } else if (ev.type === 'tool') {
          addToolLine(ev.tool, ev.text);
          bubble = null;
          typing = addTyping();
        } else if (ev.type === 'preview') addPreview(ev.tool, ev.result);
        else if (ev.type === 'ask') addAsk(ev);
        else if (ev.type === 'navigate') navigate(ev.to);
      },
    });
  } catch (err) {
    typing?.remove();
    typing = null;
    // a IA travou (memória, GPU perdida): desliga e responde no modo básico
    ai.status = 'error';
    ai.error = String(err.message || err);
    chat = null;
    await AI.unload();
    renderSetup();
    const r = parseBasic(text, store.today);
    if (r.reply) addBubble('assistant', `A IA travou (${ai.error.slice(0, 80)}). No modo básico:\n${r.reply}`);
    else { addBubble('assistant', 'A IA travou; resolvi pelo modo básico:'); await runAndShow(r.tool, r.args, r.fallback); }
  } finally {
    typing?.remove();
    abort = null;
    ai.lastMs = Math.round(performance.now() - started);
  }
}

function setSending(on) {
  if (!panel) return;
  panel.querySelector('.as-input button').disabled = on;
  panel.classList.toggle('busy', on);
}

// ---------------------------------------------------------------- IA: preparar, baixar, ligar

async function refreshAI() {
  if (ai.status === 'downloading' || ai.status === 'loading' || ai.status === 'ready') { renderSetup(); return; }
  ai.status = 'checking';
  renderSetup();
  ai.support = await AI.checkSupport();
  const st = AI.modelStatus();
  ai.loaded = st.loaded;
  ai.total = st.total;
  if (st.done) {
    ai.status = ai.support.webgpu ? 'ready-file' : 'unsupported';
    renderSetup();
    if (ai.support.webgpu) loadAI().catch(() => {});
    return;
  }
  ai.status = ai.support.ok ? (st.loaded > 0 ? 'paused' : 'absent') : 'unsupported';
  renderSetup();
}

export function loadAI() {
  if (ai.status === 'ready') return Promise.resolve();
  if (ai.loadPromise) return ai.loadPromise;
  ai.status = 'loading';
  renderSetup();
  ai.loadPromise = (async () => {
    try {
      const name = store.profile?.name?.split(' ')[0] || '';
      chat = await AI.createChat(buildSystemPrompt(tools, { userName: name }));
      ai.status = 'ready';
      ai.error = '';
    } catch (err) {
      chat = null;
      ai.status = 'error';
      ai.error = err.message || String(err);
      throw err;
    } finally {
      ai.loadPromise = null;
      renderSetup();
    }
  })();
  return ai.loadPromise;
}

function startDownload() {
  ai.status = 'downloading';
  renderSetup();
  AI.downloadModel((m) => {
    if (m.type === 'progress' || m.type === 'start') { ai.loaded = m.loaded ?? m.offset ?? ai.loaded; ai.total = m.total || ai.total; }
    if (m.type === 'paused') { ai.status = 'paused'; ai.loaded = m.loaded; }
    if (m.type === 'error') { ai.status = 'paused'; ai.error = m.message; }
    if (m.type === 'done') {
      ai.status = 'ready-file';
      ai.error = '';
      toast('IA baixada! Ligando…', { tone: 'cyan' });
      loadAI().then(() => { if (assistantOpen()) addBubble('assistant', 'Pronto: agora sou uma IA rodando no seu celular, sem internet. Pode falar comigo do seu jeito.'); }).catch(() => {});
    }
    renderSetup(m.type === 'progress');
  });
}

function renderSetup(progressOnly = false) {
  if (!panel) return;
  const status = panel.querySelector('[data-as="status"]');
  const label = { ready: '● IA no aparelho · offline', loading: 'Ligando a IA…', downloading: 'Baixando a IA… · modo básico ativo' }[ai.status] || 'Modo básico · entende frases simples';
  status.textContent = label;
  status.className = `tiny ${ai.status === 'ready' ? 'on' : ''}`;
  let card = logEl.querySelector('.as-setup');
  const pct = ai.total ? Math.min(100, (ai.loaded / ai.total) * 100) : 0;
  if (progressOnly && card) {
    const bar = card.querySelector('.meter > i');
    const txt = card.querySelector('[data-prog]');
    if (bar) bar.style.width = `${pct}%`;
    if (txt) txt.textContent = `${AI.fmtBytes(ai.loaded)} de ${ai.total ? AI.fmtBytes(ai.total) : `~${AI.fmtBytes(AI.APPROX_BYTES)}`}`;
    return;
  }
  const s = ai.support;
  let html = '';
  if (ai.status === 'checking') html = '<div class="tiny">Verificando o que este celular aguenta…</div>';
  else if (ai.status === 'unsupported') {
    html = `<b>IA completa indisponível neste navegador</b><div class="tiny">${esc((s?.reasons || []).join(' '))}</div>
      <div class="tiny">O modo básico funciona normalmente: <button class="linkish" type="button" data-as-act="help">veja o que ele entende</button>.</div>`;
  } else if (ai.status === 'absent') {
    html = `<b>${icon('cpu')} Ligue a IA no seu celular</b>
      <div class="tiny">${AI.MODEL_LABEL}: baixa ~${AI.fmtBytes(AI.APPROX_BYTES)} uma vez (use o Wi‑Fi). Depois conversa sem internet e nada sai do celular. Enquanto isso, o modo básico já funciona.</div>
      ${(s?.warnings || []).map((w) => `<div class="tiny c-amber">${esc(w)}</div>`).join('')}
      <button class="btn primary sm" type="button" data-as-act="download">${icon('download')}Baixar IA (~${AI.fmtBytes(AI.APPROX_BYTES)})</button>`;
  } else if (ai.status === 'downloading' || ai.status === 'paused') {
    html = `<b>${ai.status === 'paused' ? 'Download pausado' : 'Baixando a IA…'}</b>
      <div class="meter" style="margin:8px 0"><i style="width:${pct}%"></i></div>
      <div class="tiny" data-prog>${AI.fmtBytes(ai.loaded)} de ${ai.total ? AI.fmtBytes(ai.total) : `~${AI.fmtBytes(AI.APPROX_BYTES)}`}</div>
      ${ai.error && ai.status === 'paused' ? `<div class="tiny c-amber">${esc(ai.error)}</div>` : ''}
      <div class="tiny">Deixe o app aberto e a tela ligada. Se cair, continua de onde parou.</div>
      ${ai.status === 'paused' ? `<button class="btn primary sm" type="button" data-as-act="download">${icon('play')}Continuar</button>` : `<button class="btn sm ghost" type="button" data-as-act="pause">${icon('pause')}Pausar</button>`}`;
  } else if (ai.status === 'ready-file' || ai.status === 'loading') {
    html = `<b>Ligando a IA…</b><div class="tiny">Carregando o modelo na memória. Na primeira vez pode levar até um minuto${navigator.onLine ? '' : ' (e precisa de internet uma única vez para o motor)'}.</div>`;
  } else if (ai.status === 'error' && AI.needsIsolation(ai.error)) {
    html = `<b>Falta um passo para ligar a IA</b><div class="tiny">O motor da IA precisa que o app abra num modo protegido. É só tocar abaixo (o app recarrega e continua de onde parou).</div>
      <button class="btn primary sm" type="button" data-as-act="isolate">${icon('refresh')}Reabrir no modo da IA</button>`;
  } else if (ai.status === 'error') {
    html = `<b>A IA não ligou</b><div class="tiny">${esc(ai.error)}</div>
      <div class="row wrap" style="gap:8px"><button class="btn sm" type="button" data-as-act="load">${icon('refresh')}Tentar de novo</button>
      <button class="btn sm ghost" type="button" data-as-act="redownload">Baixar de novo</button></div>
      <div class="tiny">O modo básico continua funcionando.</div>`;
  }
  if (!html) { card?.remove(); return; }
  if (!card) {
    card = document.createElement('div');
    card.className = 'as-setup card tight stack';
    logEl.prepend(card);
  }
  card.innerHTML = html;
}

// ---------------------------------------------------------------- gerenciar (Ajustes)

export function aiSettingsHTML() {
  const st = AI.modelStatus();
  return `<section class="card tight"><span class="eyebrow">Assistente com IA</span>
    <p class="small" style="margin:6px 0 10px">${st.done ? `Modelo ${AI.MODEL_LABEL} guardado no celular (${AI.fmtBytes(st.size)}). Funciona sem internet.` : st.loaded ? `Download parado em ${AI.fmtBytes(st.loaded)}.` : 'A IA ainda não foi baixada. O modo básico já funciona.'}</p>
    <div class="row wrap" style="gap:8px"><button class="btn sm" type="button" data-ai="open">${icon('chat')}Abrir assistente</button>
    ${st.done || st.loaded ? `<button class="btn sm ghost" type="button" data-ai="delete">${icon('trash')}Apagar a IA (libera ${AI.fmtBytes(st.size || st.loaded)})</button>` : ''}</div></section>`;
}

export function bindAISettings(root, close) {
  root.querySelector('[data-ai="open"]')?.addEventListener('click', () => { close(); openAssistant(); });
  root.querySelector('[data-ai="delete"]')?.addEventListener('click', async () => {
    close();
    await AI.deleteModel();
    chat = null;
    ai.status = 'idle';
    toast('IA apagada do celular. O modo básico continua.');
  });
}
