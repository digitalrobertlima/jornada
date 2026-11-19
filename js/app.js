// Jornada — PWA local-first de resgate financeiro.
// Boot, roteamento das 4 abas, ações globais e rotinas diárias (agendados, rendimento, cotações).

import { store } from './store.js';
import { todayISO } from './core/dates.js';
import { esc, toast, copyText, $, $$ } from './ui/dom.js';
import { processScheduled } from './engines/cashflow.js';
import { accrueYield } from './engines/satsYield.js';
import { ERAS } from './engines/eraMachine.js';
import { negotiationScript } from './engines/scripts.js';
import { refreshMarket as fetchMarket } from './services/market.js';
import { renderHUD, mountHUD, tickCountdowns } from './ui/views/hud.js';
import { renderWallet, mountWallet } from './ui/views/wallet.js';
import { renderBattle, mountBattle } from './ui/views/battle.js';
import { renderSovereign } from './ui/views/sovereign.js';
import {
  renderOnboarding, openObligationWizard, openObligationDetail, openPaySheet, openScriptSheet,
  openEntrySheet, removeEntry, openAccountWizard, openProfileWizard, openAporteSheet, openSatsUpdateSheet,
} from './ui/wizards.js';
import { openSimulator } from './ui/simulator.js';
import { openEssentials, openVictories, openEntry } from './ui/sheets.js';
import { openForecastSheet, openForecastDetail, openPlanSheet } from './ui/forecast.js';
import { schedulePush, renderCloudButton, syncNow, connectGoogle, cloudConnected, setReloadHook } from './ui/cloud.js';
import { openSettings, clearAll } from './ui/settings.js';

const view = document.getElementById('view');
const TABS = ['hud', 'wallet', 'battle', 'vault'];
let cleanup = null;
let lastHUD = null;
let totemHeights = new Map();

// ---------------------------------------------------------------- render

function renderHeader(d) {
  const sw = document.getElementById('profile-switch');
  const chip = document.getElementById('era-chip');
  const settingsBtn = document.getElementById('btn-settings');
  const has = store.state.profiles.length > 0;
  settingsBtn.hidden = !has;
  renderCloudButton();
  if (!has || !d) {
    sw.innerHTML = '';
    chip.hidden = true;
    return;
  }
  const era = ERAS[d.eras.currentEra - 1];
  chip.hidden = false;
  chip.textContent = `Fase ${d.eras.currentEra}`;
  chip.title = era.name;
  sw.innerHTML = store.state.profiles.map((p) => `<button type="button" class="avatar" style="--hue:${p.hue}" data-profile="${esc(p.id)}"
      aria-pressed="${p.id === store.pid}" aria-label="Perfil ${esc(p.name)}" title="${esc(p.name)}">${esc(p.name.trim().charAt(0).toUpperCase() || '?')}</button>`).join('')
    + '<button type="button" class="avatar add" data-act="profile-new" aria-label="Adicionar perfil" title="Adicionar perfil">+</button>';
  const badge = document.getElementById('badge-front');
  const urgent = d.tri.frontline.filter((i) => i.isProtestable || i.late > 0).length
    + d.tri.battlefield.filter((i) => i.late > 0).length;
  badge.hidden = urgent === 0;
  badge.textContent = String(urgent);
}

function render() {
  cleanup?.();
  cleanup = null;
  if (!store.state.profiles.length) {
    renderHeader(null);
    renderOnboarding(view, { onDone: afterReload });
    return;
  }
  document.body.classList.remove('hide-nav');
  const d = store.derive();
  renderHeader(d);
  for (const b of $$('.bottom-nav [data-tab]')) b.setAttribute('aria-current', b.dataset.tab === store.tab ? 'page' : 'false');

  if (store.tab === 'hud') {
    view.innerHTML = renderHUD(d, store);
    mountHUD(view, d, lastHUD?.pid === d.pid ? lastHUD : null);
    lastHUD = { cash: d.cash, life: d.profile.rescuedLifeMinutes, pid: d.pid };
    const timer = setInterval(() => tickCountdowns(view), 30000);
    cleanup = () => clearInterval(timer);
  } else if (store.tab === 'wallet') {
    view.innerHTML = renderWallet(d, store);
    cleanup = mountWallet(view, d, store);
  } else if (store.tab === 'battle') {
    view.innerHTML = renderBattle(d);
    totemHeights = mountBattle(view, totemHeights);
  } else {
    view.innerHTML = renderSovereign(d, store);
  }
}

async function onStateChange() {
  await housekeepingEras();
  render();
}

store.onChange = () => { onStateChange(); schedulePush(); };
store.onAction = (action) => {
  toast(`Feito: ${esc(action.label)}`, {
    tone: 'cyan', timeout: 7000,
    action: { label: 'Desfazer', onClick: async () => { await store.undo(action.id); toast('Desfeito. Tudo voltou ao que era.'); } },
  });
};

function setTab(tab) {
  if (!TABS.includes(tab)) return;
  store.tab = tab;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  try { history.replaceState(null, '', `#${tab}`); } catch { /* file:// */ }
}

// ---------------------------------------------------------------- rotinas

/** Atualiza a Era do perfil, linhas de base e celebra a virada. */
async function housekeepingEras() {
  const d = store.derive();
  if (!d) return;
  const p = d.profile;
  const changes = { profiles: [] };
  const next = { ...p };
  let dirty = false;
  if (d.eras.currentEra !== p.currentEra) {
    if (d.eras.currentEra > p.currentEra) {
      const era = ERAS[d.eras.currentEra - 1];
      setTimeout(() => toast(`<b>Era ${era.roman} desbloqueada — ${esc(era.name)}.</b> ${esc(era.goal)}`, { tone: 'cyan', iconName: 'spark', timeout: 7000 }), 300);
    }
    next.currentEra = d.eras.currentEra;
    next.eraLog = [...(p.eraLog || []), { era: d.eras.currentEra, date: store.today }];
    dirty = true;
  }
  const bf = d.tri.battlefield.reduce((s, i) => s + i.updated, 0);
  if (bf > (p.baselines?.battlefield || 0) + 0.01) {
    next.baselines = { ...(p.baselines || {}), battlefield: Math.round(bf * 100) / 100 };
    dirty = true;
  }
  if (dirty) {
    changes.profiles.push(next);
    await store.commit(changes, { render: false });
  }
}

/** Lançamentos agendados que venceram + rendimento em sats. */
async function dailyRoutines() {
  const changes = processScheduled(store.state, store.today, { btcPrice: store.btcPrice() });
  const cdi = store.cdi();
  const price = store.btcPrice();
  const accounts = [...changes.accounts];
  for (const acc of store.state.accounts) {
    const current = accounts.find((a) => a.id === acc.id) || acc;
    const out = accrueYield(current, { today: store.today, cdiAnnual: cdi, btcPrice: price });
    if (out) {
      const i = accounts.findIndex((a) => a.id === out.id);
      if (i >= 0) accounts[i] = out; else accounts.push(out);
    }
  }
  changes.accounts = accounts;
  if (changes.ledger.length || changes.accounts.length || changes.obligations.length) {
    await store.commit(changes, { render: false });
  }
}

async function refreshMarket(force = false) {
  if (store.meta.liveMarket === false && !force) return;
  const { cache, changed, errors } = await fetchMarket(store.meta.market || {}, { force });
  if (changed) {
    await store.setMeta('market', cache);
    await dailyRoutines();
    render();
  }
  if (force && errors.length && errors[0] !== 'offline') toast(`Sem cotação agora: ${esc(errors[0].slice(0, 120))}`, { tone: 'magenta' });
  if (force && errors[0] === 'offline') toast('Sem internet: usando a última cotação salva.');
}

async function afterReload() {
  totemHeights = new Map();
  lastHUD = null;
  if (!TABS.includes(store.tab)) store.tab = 'hud';
  await dailyRoutines();
  await housekeepingEras();
  render();
  refreshMarket();
}

// ---------------------------------------------------------------- ações

const actions = {
  goto: (el) => setTab(el.dataset.tab),
  caiu: (el) => openSimulator({ debtId: el.dataset.debt || null }),
  pay: (el) => openPaySheet(el.dataset.id, { protest: el.dataset.protest === '1', settle: el.dataset.settle === '1' }),
  script: async (el) => {
    openScriptSheet(el.dataset.id);
  },
  'obligation-new': (el) => openObligationWizard(el.dataset.kind),
  'obligation-open': (el) => openObligationDetail(el.dataset.id),
  'entry-new': (el) => openEntrySheet({ dir: el.dataset.dir || 'out', accountId: el.dataset.account || null }),
  'entry-del': (el) => removeEntry(el.dataset.id),
  'entry-open': (el) => openEntry(el.dataset.id),
  'forecast-new': () => openForecastSheet(),
  'forecast-open': (el) => openForecastDetail(el.dataset.id),
  'forecast-plan': () => openPlanSheet(),
  essentials: () => openEssentials(),
  victories: () => openVictories(),
  'account-new': () => openAccountWizard(),
  'account-edit': (el) => openAccountWizard(el.dataset.id),
  'profile-new': () => openProfileWizard(),
  'demo-clear': () => clearAll(afterReload),
  'market-refresh': () => refreshMarket(true),
  aporte: () => openAporteSheet(),
  'sats-update': () => openSatsUpdateSheet(),
};

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('.bottom-nav [data-tab]');
  if (tab) { setTab(tab.dataset.tab); return; }
  const prof = e.target.closest('[data-profile]');
  if (prof) {
    if (prof.dataset.profile !== store.pid) {
      await store.setMeta('activeProfileId', prof.dataset.profile);
      totemHeights = new Map();
      await housekeepingEras();
      render();
      toast(`Perfil: ${esc(store.profile.name)}`);
    }
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) {
    e.preventDefault();
    e.stopPropagation();
    actions[el.dataset.act](el);
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('span[role=button][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.getElementById('btn-settings').addEventListener('click', () => openSettings({ onReload: afterReload, refreshMarket }));
document.getElementById('btn-cloud').addEventListener('click', async () => {
  try {
    if (!cloudConnected()) await connectGoogle();
    else {
      const d = await syncNow({ interactive: true });
      toast(d === 'pull' ? 'Dados atualizados com os do Google.' : 'Salvo no seu Google Drive.', { tone: 'cyan' });
    }
  } catch (err) { toast(esc(err.message), { tone: 'magenta' }); }
});
setReloadHook(() => afterReload());

// virada do dia com o app aberto / volta do segundo plano
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !store.state.profiles.length) return;
  const t = todayISO();
  if (t !== store.today) {
    store.today = t;
    await afterReload();
  } else {
    refreshMarket();
  }
});
window.addEventListener('online', () => refreshMarket());

// ---------------------------------------------------------------- service worker

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    const announce = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          const zone = document.getElementById('toasts');
          const el = document.createElement('div');
          el.className = 'toast cyan';
          el.innerHTML = '<div class="grow">Nova versão do Jornada disponível.</div><button class="btn sm primary" type="button">Atualizar</button>';
          el.querySelector('button').onclick = () => worker.postMessage('SKIP_WAITING');
          zone.appendChild(el);
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => announce(reg.installing));
  }).catch(() => { /* sem SW: o app continua funcionando online */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    await store.load();
  } catch (err) {
    view.innerHTML = `<div class="alert">${esc(err.message)} Tente abrir fora da aba anônima ou em outro navegador.</div>`;
    return;
  }
  const hash = location.hash.replace('#', '');
  if (TABS.includes(hash)) store.tab = hash;
  await afterReload();
  const params = new URLSearchParams(location.search);
  if (params.get('action') === 'caiu' && store.state.profiles.length) openSimulator();
  if (params.get('action') === 'lancar' && store.state.profiles.length) openEntrySheet({ dir: 'out' });
  registerSW();
}

boot();

// exposto para depuração no console
window.jornada = { store, copyText, negotiationScript, $ };
