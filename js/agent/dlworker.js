// Worker de download do modelo (≈2 GB): grava direto no armazenamento privado do navegador (OPFS),
// em pedaços, e retoma de onde parou se a internet cair ou a pessoa pausar.

let controller = null;

const post = (m) => self.postMessage(m);

self.onmessage = (e) => {
  const { cmd } = e.data || {};
  if (cmd === 'start') run(e.data).catch((err) => post({ type: 'error', message: String(err?.message || err) }));
  if (cmd === 'pause' && controller) controller.abort();
};

async function run({ urls, fileName, minBytes }) {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle(fileName, { create: true });
  const handle = await fh.createSyncAccessHandle();
  controller = new AbortController();
  try {
    let offset = handle.getSize();
    let lastErr = null;
    for (const url of urls) {
      try {
        const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
        const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
        if (res.status === 404 || res.status === 403) { lastErr = new Error(`Arquivo não encontrado (${res.status})`); continue; }
        if (res.status === 416) { // já estava completo
          handle.flush();
          post({ type: 'done', size: offset, url });
          return;
        }
        if (!res.ok) throw new Error(`O servidor respondeu ${res.status}`);
        if (offset > 0 && res.status === 200) { handle.truncate(0); offset = 0; } // servidor ignorou a retomada
        const len = Number(res.headers.get('content-length')) || 0;
        const total = len ? offset + len : null;
        post({ type: 'start', url, total, offset });
        const reader = res.body.getReader();
        let sinceFlush = 0;
        let lastPost = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          handle.write(value, { at: offset });
          offset += value.byteLength;
          sinceFlush += value.byteLength;
          if (sinceFlush > 32 * 1024 * 1024) { handle.flush(); sinceFlush = 0; }
          const now = Date.now();
          if (now - lastPost > 300) { post({ type: 'progress', loaded: offset, total }); lastPost = now; }
        }
        handle.flush();
        if (total && offset < total) throw new Error('A conexão caiu no meio. Toque em continuar.');
        if (minBytes && offset < minBytes) throw new Error('O arquivo baixado veio pequeno demais. Tente de novo.');
        post({ type: 'done', size: offset, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          handle.flush();
          post({ type: 'paused', loaded: offset });
          return;
        }
        lastErr = err;
        break;
      }
    }
    post({ type: 'error', message: lastErr ? String(lastErr.message || lastErr) : 'Falha no download.', loaded: offset });
  } finally {
    try { handle.close(); } catch { /* já fechado */ }
    controller = null;
  }
}
