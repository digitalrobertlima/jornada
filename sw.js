// Service Worker — Cache-First versionado, com fallback offline.
// Caminhos relativos ao escopo: funciona em https://digitalrobertlima.github.io/jornada/.

const VERSION = 'jornada-v2.3.0';
// Motor da IA (biblioteca do CDN): cache próprio, que sobrevive às atualizações do app.
const AI_LIB_CACHE = 'ai-lib-v1';
const AI_LIB_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'esm.sh', 'storage.googleapis.com'];
const AI_LIB_MAX = 150 * 1024 * 1024; // nunca guardar arquivo gigante (o modelo vai para o OPFS, não para cá)

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './js/app.js',
  './js/store.js',
  './js/core/dates.js',
  './js/core/format.js',
  './js/core/model.js',
  './js/core/util.js',
  './js/db/vault.js',
  './js/db/demoScenario.js',
  './js/parsers/boletoParser.js',
  './js/engines/lifeHours.js',
  './js/engines/triage.js',
  './js/engines/cashflow.js',
  './js/engines/eraMachine.js',
  './js/engines/satsYield.js',
  './js/engines/scripts.js',
  './js/engines/journal.js',
  './js/engines/guide.js',
  './js/services/market.js',
  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/deck3d.js',
  './js/ui/flowChart.js',
  './js/ui/wizards.js',
  './js/ui/simulator.js',
  './js/ui/settings.js',
  './js/ui/sheets.js',
  './js/ui/cloud.js',
  './js/ui/forecast.js',
  './js/ui/assistant.js',
  './js/core/text.js',
  './js/recipes/formula.js',
  './js/recipes/model.js',
  './js/recipes/ui.js',
  './js/agent/tools.js',
  './js/agent/basic.js',
  './js/agent/protocol.js',
  './js/agent/llm.js',
  './js/agent/dlworker.js',
  './js/engines/forecast.js',
  './js/engines/freedom.js',
  './js/services/googleSync.js',
  './js/config.js',
  './js/ui/views/hud.js',
  './js/ui/views/wallet.js',
  './js/ui/views/battle.js',
  './js/ui/views/sovereign.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('jornada-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Modo isolado (?isolar=1): alguns motores de IA precisam de "cross-origin isolation" (SharedArrayBuffer).
// O GitHub Pages não deixa configurar cabeçalhos, então o service worker coloca os cabeçalhos ele mesmo.
async function isolateIfAsked(event, res) {
  let on = false;
  try {
    if (event.request.mode === 'navigate') on = new URL(event.request.url).searchParams.get('isolar') === '1';
    else if (event.clientId) {
      const c = await self.clients.get(event.clientId);
      on = Boolean(c && new URL(c.url).searchParams.get('isolar') === '1');
    }
  } catch { on = false; }
  if (!on || !res || res.type === 'opaque' || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Motor da IA: guarda na primeira vez para funcionar offline depois.
  if (AI_LIB_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(AI_LIB_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      const size = Number(res.headers.get('content-length')) || 0;
      if (res.ok && size <= AI_LIB_MAX) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  // Cotações, modelo da IA (Hugging Face) e qualquer outra origem: direto na rede, sem cache aqui.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return isolateIfAsked(event, cached);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return isolateIfAsked(event, res);
    } catch {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// ---------------------------------------------------------------- lembretes com o app fechado
// O celular acorda o service worker de tempos em tempos (Periodic Background Sync, só app instalado).
// Lemos as peças do cofre local e avisamos os lembretes do dia. Nada sai do aparelho.

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysISO = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function idb(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const all = (db, store) => new Promise((resolve) => {
  if (!db.objectStoreNames.contains(store)) { resolve([]); return; }
  const r = db.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => resolve(r.result || []);
  r.onerror = () => resolve([]);
});
const getMeta = (db, key) => new Promise((resolve) => {
  const r = db.transaction('meta').objectStore('meta').get(key);
  r.onsuccess = () => resolve(r.result ? r.result.value : null);
  r.onerror = () => resolve(null);
});
const putMeta = (db, key, value) => new Promise((resolve) => {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  tx.oncomplete = () => resolve();
  tx.onerror = () => resolve();
});

async function checkReminders() {
  const db = await idb('jornada-vault');
  try {
    const pid = await getMeta(db, 'activeProfileId');
    const recipes = (await all(db, 'recipes')).filter((r) => r.piece === 'lembrete' && r.enabled !== false && r.profileId === pid);
    if (!recipes.length) return;
    const obligations = await all(db, 'obligations');
    const today = isoLocal();
    const seen = new Set((await getMeta(db, 'notified')) || []);
    const fresh = [];
    for (const r of recipes) {
      const s = r.spec || {};
      const done = (r.state && r.state.feito) || [];
      const push = (key) => { if (!done.includes(key) && !seen.has(`${r.id}@${key}`)) fresh.push({ id: `${r.id}@${key}`, text: s.texto }); };
      if (s.tipo === 'data' && s.data && today >= s.data) push(s.data);
      if (s.tipo === 'mensal') {
        const [y, m] = today.split('-').map(Number);
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const occ = `${today.slice(0, 8)}${pad(Math.min(s.dia || 1, last))}`;
        if (today >= occ) push(occ);
      }
      if (s.tipo === 'antes_vencimento') {
        const q = norm(s.conta);
        for (const o of obligations) {
          if (o.status === 'paid' || !o.dueDate || !(o.profileId === pid || o.isShared)) continue;
          const n = norm(o.beneficiary);
          if (!(n.includes(q) || q.includes(n))) continue;
          if (today >= addDaysISO(o.dueDate, -(s.dias ?? 2)) && today <= o.dueDate) push(o.dueDate);
        }
      }
    }
    for (const f of fresh) {
      await self.registration.showNotification('Jornada · lembrete', { body: f.text, tag: f.id, icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png' });
    }
    if (fresh.length) await putMeta(db, 'notified', [...seen, ...fresh.map((f) => f.id)].slice(-60));
  } finally {
    db.close();
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'jornada-lembretes') event.waitUntil(checkReminders().catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow('./');
  })());
});
