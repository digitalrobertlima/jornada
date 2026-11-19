// Login com Google + cópia dos dados no Google Drive DO PRÓPRIO USUÁRIO.
// Sem servidor nosso: o navegador fala direto com o Google. A permissão `drive.file`
// só enxerga os arquivos que o próprio Jornada criou — nada mais do Drive da pessoa.

import { CONFIG } from '../config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email profile';
export const FILE_NAME = 'jornada-dados.json';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let token = null;
let tokenExp = 0;
let gisPromise = null;

export const isConfigured = () => Boolean(CONFIG.googleClientId);
export const hasToken = () => Boolean(token) && Date.now() < tokenExp;

function loadGIS() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Não deu para falar com o Google. Confira a internet.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Abre o login do Google (precisa ser chamado a partir de um toque). */
export async function signIn({ hint = '', silent = false } = {}) {
  if (!isConfigured()) throw new Error('Login com Google ainda não foi configurado neste app.');
  await loadGIS();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        token = resp.access_token;
        tokenExp = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Login cancelado.' : e?.type === 'popup_failed_to_open' ? 'O navegador bloqueou a janela do Google. Permita pop-ups e tente de novo.' : (e?.message || 'Falha no login.'))),
    });
    client.requestAccessToken({ prompt: silent ? '' : 'select_account', login_hint: hint || undefined });
  });
}

export function signOut() {
  try { if (token) google.accounts.oauth2.revoke(token, () => {}); } catch { /* ignora */ }
  token = null;
  tokenExp = 0;
}

async function api(url, opts = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) {
    token = null;
    throw new Error('A sessão do Google expirou. Toque em "Sincronizar agora" para entrar de novo.');
  }
  if (!res.ok) throw new Error(`Google Drive respondeu com erro ${res.status}.`);
  return res;
}

export async function userInfo() {
  return (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json();
}

/** Arquivo do Jornada no Drive (o mais recente), ou null. */
export async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`${DRIVE}?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)&pageSize=1`);
  const json = await res.json();
  return json.files?.[0] || null;
}

export async function readFile(id) {
  return (await api(`${DRIVE}/${id}?alt=media`)).text();
}

/** Cria ou atualiza o arquivo. Devolve o id. */
export async function writeFile(id, text) {
  if (id) {
    await api(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
    return id;
  }
  const boundary = `jornada${Math.random().toString(36).slice(2)}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return (await res.json()).id;
}

/**
 * Decide o que fazer ao conectar: enviar os dados do aparelho, baixar os do Google ou perguntar.
 * @param {{localEmpty:boolean, localAt:number, remoteAt:number|null, lastSyncAt:number|null}} s
 * @returns {'push'|'pull'|'ask'|'none'}
 */
export function decideSync({ localEmpty, localAt, remoteAt, lastSyncAt }) {
  if (remoteAt == null) return localEmpty ? 'none' : 'push';
  if (localEmpty) return 'pull';
  if (lastSyncAt) {
    const localChanged = localAt > lastSyncAt + 1000;
    const remoteChanged = remoteAt > lastSyncAt + 1000;
    if (localChanged && !remoteChanged) return 'push';
    if (!localChanged && remoteChanged) return 'pull';
    if (!localChanged && !remoteChanged) return 'none';
  }
  return 'ask';
}
