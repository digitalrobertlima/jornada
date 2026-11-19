// Sincronização com o Google Drive do usuário: conectar, enviar automático, baixar e escolher.

import { store } from '../store.js';
import { vault, Vault } from '../db/vault.js';
import { esc, openSheet, toast } from './dom.js';
import { icon } from './icons.js';
import * as G from '../services/googleSync.js';

let pushTimer = null;
let reloadHook = () => {};

export const cloudConfigured = () => G.isConfigured();
export const cloudConnected = () => Boolean(store.meta.google?.email);
export const cloudLive = () => G.hasToken();

export function setReloadHook(fn) { reloadHook = fn; }

function fmt(ts) {
  if (!ts) return 'nunca';
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function snapshotText() {
  return vault.exportBackup({ market: store.meta.market, manual: store.meta.manual });
}

async function setStatus(state, error = '') {
  store.meta.syncStatus = { state, error, at: Date.now() };
  renderCloudButton();
}

async function push(fileId) {
  const text = await snapshotText();
  let id;
  try {
    id = await G.writeFile(fileId, text);
  } catch (err) {
    if (!fileId) throw err;
    id = await G.writeFile((await G.findFile())?.id || null, text); // arquivo apagado/movido: recria
  }
  await store.setMeta('lastSync', { at: Date.parse(JSON.parse(text).exportedAt), fileId: id });
}

async function pull(remoteText, remoteAt, fileId) {
  const hadLocal = store.state.profiles.length > 0 && !store.meta.demo;
  const previous = hadLocal ? await snapshotText() : null;
  const { state, settings } = Vault.parseBackup(remoteText);
  await store.replaceAll(state, {
    activeProfileId: state.profiles[0].id, demo: false, manual: settings.manual || {}, market: settings.market || store.meta.market,
  });
  await store.setMeta('lastLocalChange', remoteAt);
  await store.setMeta('lastSync', { at: remoteAt, fileId });
  reloadHook();
  if (previous) {
    toast('Dados do Google carregados.', {
      tone: 'cyan', timeout: 9000,
      action: {
        label: 'Desfazer',
        onClick: async () => {
          const back = Vault.parseBackup(previous);
          await store.replaceAll(back.state, { activeProfileId: back.state.profiles[0].id, demo: false });
          reloadHook();
          toast('Voltaram os dados deste aparelho.');
        },
      },
    });
  }
}

function askWhich(remoteAt, localAt) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title: 'Qual versão usar?',
      body: `<div class="stack">
        <p class="small">Há dados diferentes neste aparelho e no seu Google Drive.</p>
        <button class="btn primary block" type="button" data-v="pull">${icon('download')}Usar os do Google (salvos em ${fmt(remoteAt)})</button>
        <button class="btn block" type="button" data-v="push">${icon('upload')}Usar os deste aparelho (mudados em ${fmt(localAt)})</button>
        <p class="tiny">A versão que ficar de fora pode ser recuperada: se escolher os do Google, aparece "Desfazer" logo depois.</p>
      </div>`,
      onMount(el, close) {
        el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { answered = true; resolve(b.dataset.v); close(); }));
      },
      onClose() { if (!answered) resolve(null); },
    });
  });
}

/** Sincroniza agora. `interactive` = veio de um toque (pode abrir o login do Google). */
export async function syncNow({ interactive = false } = {}) {
  if (!G.isConfigured()) return 'off';
  if (!G.hasToken()) {
    if (!interactive) return 'needs-login';
    await G.signIn({ hint: store.meta.google?.email || '' });
  }
  await setStatus('syncing');
  try {
    const file = await G.findFile();
    let remoteText = null;
    let remoteAt = null;
    if (file) {
      remoteText = await G.readFile(file.id);
      try { remoteAt = Date.parse(JSON.parse(remoteText).exportedAt) || null; } catch { remoteAt = null; }
    }
    const localEmpty = !store.state.profiles.length || Boolean(store.meta.demo);
    let decision = G.decideSync({ localEmpty, localAt: store.meta.lastLocalChange || 0, remoteAt, lastSyncAt: store.meta.lastSync?.at || null });
    if (decision === 'ask') decision = (await askWhich(remoteAt, store.meta.lastLocalChange)) || 'none';
    if (decision === 'pull') await pull(remoteText, remoteAt, file.id);
    else if (decision === 'push') await push(file?.id || null);
    else if (file) await store.setMeta('lastSync', { at: store.meta.lastSync?.at || remoteAt, fileId: file.id });
    await setStatus('ok');
    return decision;
  } catch (err) {
    await setStatus('error', err.message);
    throw err;
  }
}

export async function connectGoogle() {
  await G.signIn({ hint: store.meta.google?.email || '' });
  const info = await G.userInfo();
  await store.setMeta('google', { email: info.email, name: info.name || info.email, picture: info.picture || '' });
  const decision = await syncNow({ interactive: true });
  const msg = { pull: 'Seus dados foram carregados do Google.', push: 'Pronto: seus dados agora têm cópia no seu Google Drive.', none: 'Conectado ao Google.' }[decision] || 'Conectado.';
  toast(msg, { tone: 'cyan', iconName: 'check' });
  return decision;
}

export async function disconnectGoogle() {
  G.signOut();
  await store.setMeta('google', null);
  await store.setMeta('lastSync', null);
  store.meta.syncStatus = null;
  renderCloudButton();
}

/** Envia automaticamente alguns segundos depois de cada mudança (enquanto o login estiver ativo). */
export function schedulePush() {
  if (!cloudConnected()) return;
  if (!G.hasToken()) { setStatus('pending'); return; }
  clearTimeout(pushTimer);
  setStatus('pending');
  pushTimer = setTimeout(async () => {
    try {
      await push(store.meta.lastSync?.fileId || null);
      await setStatus('ok');
    } catch (err) {
      await setStatus('error', err.message);
    }
  }, 2500);
}

export function renderCloudButton() {
  const btn = document.getElementById('btn-cloud');
  if (!btn) return;
  const show = G.isConfigured() && store.state.profiles.length > 0;
  btn.hidden = !show;
  if (!show) return;
  const st = store.meta.syncStatus?.state;
  let cls = 'off';
  let label = 'Salvar no Google';
  if (cloudConnected()) {
    if (!G.hasToken()) { cls = 'pending'; label = 'Toque para sincronizar com o Google'; }
    else if (st === 'syncing' || st === 'pending') { cls = 'pending'; label = 'Sincronizando…'; }
    else if (st === 'error') { cls = 'error'; label = `Erro ao sincronizar: ${store.meta.syncStatus.error}`; }
    else { cls = 'ok'; label = `Salvo no Google às ${fmt(store.meta.lastSync?.at)}`; }
  }
  btn.className = `icon-btn cloud ${cls}`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

export function cloudSectionHTML() {
  if (!G.isConfigured()) {
    return `<section class="card tight"><span class="eyebrow">Conta Google</span>
      <p class="tiny" style="margin-top:6px">O login com Google ainda não foi ativado nesta instalação do app.</p></section>`;
  }
  const g = store.meta.google;
  if (!g) {
    return `<section class="card tight"><span class="eyebrow">Conta Google</span>
      <p class="small" style="margin:6px 0 10px">Entre com Google para ter uma cópia de tudo no <b>seu</b> Google Drive. Trocou de celular? Entra de novo e tudo volta. O app não tem servidor: só você e o Google veem esses dados.</p>
      <button class="btn primary block" type="button" data-cloud="connect">${icon('cloud')}Entrar com Google</button></section>`;
  }
  const st = store.meta.syncStatus;
  return `<section class="card tight"><span class="eyebrow">Conta Google</span>
    <div class="row" style="margin-top:8px">${g.picture ? `<img src="${esc(g.picture)}" alt="" width="36" height="36" style="border-radius:50%" referrerpolicy="no-referrer">` : icon('person')}
      <div class="grow"><b>${esc(g.name)}</b><div class="tiny">${esc(g.email)}</div></div></div>
    <p class="tiny" style="margin:8px 0">Última cópia no Drive: <b>${fmt(store.meta.lastSync?.at)}</b>${st?.state === 'error' ? ` · <span class="c-magenta">${esc(st.error)}</span>` : ''}</p>
    <div class="grid-2"><button class="btn sm" type="button" data-cloud="sync">${icon('refresh')}Sincronizar agora</button>
      <button class="btn sm ghost" type="button" data-cloud="logout">Sair do Google</button></div>
    <p class="tiny" style="margin-top:8px">Sair não apaga nada deste aparelho nem do seu Drive.</p></section>`;
}

export function bindCloudSection(root, close) {
  root.querySelector('[data-cloud="connect"]')?.addEventListener('click', async () => {
    close();
    try { await connectGoogle(); } catch (err) { toast(esc(err.message), { tone: 'magenta' }); }
  });
  root.querySelector('[data-cloud="sync"]')?.addEventListener('click', async () => {
    close();
    try {
      const d = await syncNow({ interactive: true });
      toast(d === 'pull' ? 'Dados atualizados com os do Google.' : 'Sincronizado com o Google.', { tone: 'cyan' });
    } catch (err) { toast(esc(err.message), { tone: 'magenta' }); }
  });
  root.querySelector('[data-cloud="logout"]')?.addEventListener('click', async () => {
    close();
    await disconnectGoogle();
    toast('Saiu do Google. Seus dados continuam neste aparelho.');
  });
}
