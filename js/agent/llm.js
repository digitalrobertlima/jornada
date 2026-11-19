// IA no aparelho: Gemma 4 E2B rodando no navegador com LiteRT-LM (WebGPU).
// - O modelo (~2 GB) é baixado UMA vez para o armazenamento privado do navegador (OPFS), com retomada.
// - A biblioteca vem do CDN na primeira vez e o service worker guarda para funcionar offline.
// - Depois disso, nada sai do aparelho.

export const LIB_URL = 'https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm';
const REPO = 'litert-community/gemma-4-E2B-it-litert-lm';
const FILES = ['gemma-4-E2B-it-gpu.litertlm', 'gemma-4-E2B-it-web.litertlm'];
export const MODEL_LABEL = 'Gemma 4 E2B';
export const APPROX_BYTES = 2.1e9;
const FILE_NAME = 'jornada-gemma-4-e2b.litertlm';
const META_KEY = 'jornada-ia-modelo';

// Só para testes automáticos: um modelo simulado injetado na página (nunca existe em uso normal).
const FAKE = () => globalThis.__JORNADA_FAKE_LLM__ || null;

const urlFor = (f) => `https://huggingface.co/${REPO}/resolve/main/${f}`;

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || 'null') || {}; } catch { return {}; }
}
function writeMeta(m) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* sem localStorage */ }
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2).replace('.', ',')} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

/** O que este aparelho suporta. */
export async function checkSupport() {
  if (FAKE()) return { ok: true, webgpu: true, opfs: true, worker: true, memory: 8, free: 1e10, reasons: [], warnings: [] };
  const r = { webgpu: false, opfs: false, worker: typeof Worker !== 'undefined', memory: navigator.deviceMemory || null, free: null, reasons: [], warnings: [] };
  try {
    if (navigator.gpu) r.webgpu = Boolean(await navigator.gpu.requestAdapter());
  } catch { r.webgpu = false; }
  r.opfs = Boolean(navigator.storage?.getDirectory);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) r.free = est.quota - (est.usage || 0);
  } catch { /* desconhecido */ }
  if (!r.webgpu) r.reasons.push('Este navegador não liberou a placa de vídeo (WebGPU). No Android, use o Chrome atualizado (Android 12 ou mais novo); no iPhone, iOS 26 ou mais novo.');
  if (!r.opfs || !r.worker) r.reasons.push('Este navegador não permite guardar arquivos grandes.');
  const m = readMeta();
  if (!m.done && r.free != null && r.free < APPROX_BYTES * 1.1 - (m.loaded || 0)) r.reasons.push(`Falta espaço: precisa de uns ${fmtBytes(APPROX_BYTES)} livres no celular.`);
  if (r.memory && r.memory < 6) r.warnings.push('Seu celular tem pouca memória: a IA pode ficar lenta ou o navegador pode fechar a aba.');
  if (navigator.connection?.type === 'cellular' || navigator.connection?.saveData) r.warnings.push('Você parece estar nos dados móveis: o download tem cerca de 2 GB. Prefira o Wi-Fi.');
  r.ok = r.reasons.length === 0;
  return r;
}

export function modelStatus() {
  if (FAKE()) return { done: true, loaded: 1, total: 1, size: 2.0e9, url: 'fake' };
  const m = readMeta();
  return { done: Boolean(m.done), loaded: m.loaded || 0, total: m.total || null, size: m.size || 0, url: m.url || null };
}

let worker = null;

/** Baixa (ou continua baixando) o modelo. onEvent recebe {type:'progress'|'done'|'paused'|'error', ...}. */
export function downloadModel(onEvent) {
  if (worker) return;
  try { navigator.storage?.persist?.(); } catch { /* opcional */ }
  const meta = readMeta();
  // se um arquivo já falhou ao abrir, tenta primeiro o outro formato publicado
  const all = FILES.map(urlFor);
  const ordered = meta.failedUrl ? [...all.filter((u) => u !== meta.failedUrl), meta.failedUrl] : all;
  const urls = meta.url && !meta.failedUrl ? [meta.url, ...ordered.filter((u) => u !== meta.url)] : ordered;
  worker = new Worker(new URL('./dlworker.js', import.meta.url));
  worker.onmessage = (e) => {
    const m = e.data;
    const cur = readMeta();
    if (m.type === 'start') writeMeta({ ...cur, url: m.url, total: m.total || cur.total || null, loaded: m.offset });
    if (m.type === 'progress' || m.type === 'paused') writeMeta({ ...cur, loaded: m.loaded, total: m.total || cur.total || null });
    if (m.type === 'done') writeMeta({ ...cur, done: true, size: m.size, loaded: m.size, total: m.size, url: m.url, at: new Date().toISOString() });
    if (m.type === 'error') writeMeta({ ...cur, loaded: m.loaded ?? cur.loaded });
    if (['done', 'paused', 'error'].includes(m.type)) { worker.terminate(); worker = null; }
    onEvent(m);
  };
  worker.onerror = (err) => {
    worker?.terminate();
    worker = null;
    onEvent({ type: 'error', message: err.message || 'Não deu para iniciar o download neste navegador.' });
  };
  worker.postMessage({ cmd: 'start', urls, fileName: FILE_NAME, minBytes: 1e9 });
}

export function pauseDownload() {
  worker?.postMessage({ cmd: 'pause' });
}

export const isDownloading = () => Boolean(worker);

export async function deleteModel() {
  await unload();
  const failedUrl = readMeta().failedUrl || null;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(FILE_NAME);
  } catch { /* não existia */ }
  writeMeta(failedUrl ? { failedUrl } : {});
}

// ---------------------------------------------------------------- motor

let lib = null;
let engine = null;
let loading = null;

async function loadLib() {
  if (!lib) lib = await import(/* @vite-ignore */ LIB_URL);
  return lib;
}

/** Carrega a biblioteca + o modelo na memória (alguns segundos; mais na primeira vez). */
export function loadEngine({ maxNumTokens } = {}) {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  loading = (async () => {
    const meta = readMeta();
    if (!meta.done) throw new Error('O modelo ainda não foi baixado.');
    const L = await loadLib();
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(FILE_NAME)).getFile();
    const tokens = maxNumTokens || ((navigator.deviceMemory || 8) <= 4 ? 4096 : 6144);
    try {
      engine = await L.Engine.create({ model: file, mainExecutorSettings: { maxNumTokens: tokens } });
    } catch (first) {
      // algumas versões preferem receber o arquivo como fluxo
      try { engine = await L.Engine.create({ model: file.stream(), mainExecutorSettings: { maxNumTokens: tokens } }); } catch { throw first; }
    }
    engine.__tokens = tokens;
    return engine;
  })().catch((err) => {
    engine = null;
    if (!/carregar o motor|internet|ISOLAR/i.test(friendlyError(err))) { const m = readMeta(); if (m.url) writeMeta({ ...m, failedUrl: m.url }); }
    throw new Error(friendlyError(err));
  }).finally(() => { loading = null; });
  return loading;
}

export async function unload() {
  const e = engine;
  engine = null;
  try { await e?.delete?.(); } catch { /* ignore */ }
}

export const engineReady = () => Boolean(engine);

export const ISOLATE_KEY = 'jornada-isolar';
export const needsIsolation = (msg) => /SharedArrayBuffer|crossOriginIsolated|cross-origin isol|Atomics/i.test(String(msg)) && !globalThis.crossOriginIsolated;

function friendlyError(err) {
  const m = String(err?.message || err);
  if (needsIsolation(m)) return `ISOLAR: ${m.slice(0, 120)}`;
  if (/fetch|network|Failed to load module|import/i.test(m)) return 'Não consegui carregar o motor da IA. Na primeira vez ele precisa de internet; depois funciona offline.';
  if (/memory|OOM|allocation|out of/i.test(m)) return 'Faltou memória no celular para a IA. Feche outros apps e tente de novo.';
  if (/gpu|adapter|device/i.test(m)) return 'A placa de vídeo do celular não aceitou a IA (WebGPU).';
  return `A IA não abriu: ${m.slice(0, 160)}`;
}

/**
 * Conversa com o modelo. Devolve { send(texto) → async iterator de pedaços, cancel(), reset() }.
 * Quando o contexto enche, recomeça a conversa sozinho (o histórico visível continua na tela).
 */
export async function createChat(systemPrompt) {
  if (FAKE()) return FAKE().createChat(systemPrompt);
  const L = await loadLib();
  const eng = await loadEngine();
  const config = () => {
    const c = {
      preface: { messages: [{ role: 'system', content: systemPrompt }], extra_context: { enable_thinking: false } },
      sessionConfig: { maxOutputTokens: 400 },
      prefillPrefaceOnInit: true,
    };
    if (L.SamplerType?.TOP_P) c.sessionConfig.samplerParams = { type: L.SamplerType.TOP_P, temperature: 0.3, p: 0.9, k: 40 };
    return c;
  };
  let conv = await eng.createConversation(config());
  const limit = (eng.__tokens || 4096) * 0.7;
  return {
    async *send(text) {
      try {
        const count = await conv.getTokenCount?.();
        if (count && count > limit) {
          try { conv.cancel?.(); } catch { /* ignore */ }
          conv = await eng.createConversation(config());
        }
      } catch { /* sem contagem: segue */ }
      const stream = conv.sendMessageStreaming(text);
      for await (const chunk of stream) {
        const piece = typeof chunk === 'string' ? chunk
          : Array.isArray(chunk?.content) ? chunk.content.map((c) => (c && (c.type === 'text' || c.text != null) ? c.text || '' : '')).join('')
            : chunk?.text || '';
        if (piece) yield piece;
      }
    },
    cancel() { try { conv.cancel?.(); } catch { /* ignore */ } },
    async reset() { try { conv.cancel?.(); } catch { /* ignore */ } conv = await eng.createConversation(config()); },
    speed() { try { return conv.getBenchmarkInfo?.(); } catch { return null; } },
  };
}
