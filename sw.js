// Service Worker — Cache-First versionado, com fallback offline.
// Caminhos relativos ao escopo: funciona em https://digitalrobertlima.github.io/jornada/.

const VERSION = 'jornada-v1.5.0';

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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cotações e qualquer outra origem: sempre rede (nunca servir cotação velha do cache).
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
