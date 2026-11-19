// Utilitários de DOM: escape, toasts, bottom sheet, contadores animados, cópia.

import { icon } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function toast(message, { tone = '', iconName = tone === 'magenta' ? 'alert' : 'check', timeout = 3800 } = {}) {
  const zone = document.getElementById('toasts');
  if (!zone) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `${icon(iconName)}<div>${message}</div>`;
  zone.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

let openSheets = 0;

/**
 * Abre um bottom sheet.
 * @param {{title: string, body: string, onMount?: (el: HTMLElement, close: Function) => void, onClose?: Function}} opts
 */
export function openSheet({ title, body, onMount, onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `<div class="grabber"></div>
    <div class="sheet-head"><h2>${esc(title)}</h2>
      <button class="icon-btn" type="button" data-close aria-label="Fechar">${icon('x')}</button></div>
    <div class="sheet-body">${body}</div>`;
  document.body.append(backdrop, sheet);
  const prevFocus = document.activeElement;
  openSheets++;
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    openSheets--;
    if (!openSheets) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 330);
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', close);
  sheet.querySelector('[data-close]').addEventListener('click', close);
  requestAnimationFrame(() => {
    sheet.classList.add('open');
    backdrop.classList.add('open');
  });
  onMount?.(sheet, close);
  const first = sheet.querySelector('input:not([type=hidden]), select, textarea');
  if (first && window.matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 340);
  return close;
}

export function confirmSheet({ title, text, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      body: `<p class="small" style="margin-bottom:16px">${text}</p>
        <div class="row"><button class="btn ghost grow" data-no type="button">Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'} grow" data-yes type="button">${esc(confirmLabel)}</button></div>`,
      onMount(el, close) {
        el.querySelector('[data-yes]').onclick = () => { answered = true; resolve(true); close(); };
        el.querySelector('[data-no]').onclick = () => close();
      },
      onClose() { if (!answered) resolve(false); },
    });
  });
}

/** Anima um número de `from` até `to` num elemento. */
export function countUp(el, from, to, format, duration = 900) {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* sem vibração */ }
}

/** Lê os campos de um form como objeto. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

/** Liga botões de segmento (aria-pressed) a um input hidden. */
export function bindSegments(root) {
  for (const seg of $$('.seg[data-name]', root)) {
    const input = root.querySelector(`input[name="${seg.dataset.name}"]`);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      for (const x of $$('button', seg)) x.setAttribute('aria-pressed', String(x === b));
      if (input) {
        input.value = b.dataset.v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
}

/** Tela de vitória: aparece por cima de tudo por ~3s (toque fecha). */
export function celebrate({ title, big, sub, blocks = null }) {
  const el = document.createElement('div');
  el.className = 'victory';
  el.setAttribute('role', 'status');
  const bar = blocks
    ? `<div class="victory-blocks">${Array.from({ length: blocks.total }, (_, k) => `<i class="${k < blocks.paid ? 'on' : ''}${k === blocks.paid - 1 ? ' new' : ''}"></i>`).join('')}</div>` : '';
  el.innerHTML = `<div class="victory-card"><div class="victory-ring"></div>${icon('hourglass', 'victory-ic')}
    <div class="eyebrow">${title}</div><div class="victory-big num">${big}</div><div class="small">${sub}</div>${bar}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); };
  el.addEventListener('click', close);
  setTimeout(close, 3400);
}
