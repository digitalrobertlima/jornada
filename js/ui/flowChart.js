// Gráfico da Onda de Liquidez em SVG nativo (zero dependência, funciona offline).
// Linha ciano = saldo real dia a dia. Tracejado = Linha d'Água (vitais + protestáveis, 15 dias).
// Dias em que o saldo projetado fura o piso ganham marcador magenta + rótulo.

import { brl, brlShort, dateShort, dateHuman } from '../core/format.js';
import { esc } from './dom.js';

const H = 210;
const PAD = { top: 18, right: 10, bottom: 26, left: 10 };

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

export function renderWave(container, points, { floor = 0, today } = {}) {
  if (!container || !points.length) return;
  const W = Math.max(280, Math.round(container.clientWidth || 340));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const values = points.map((p) => p.balance);
  const minV = Math.min(0, ...values, floor);
  const maxV = niceMax(Math.max(...values, floor, 1) * 1.08);
  const x = (i) => PAD.left + (innerW * i) / (points.length - 1);
  const y = (v) => PAD.top + innerH * (1 - (v - minV) / (maxV - minV || 1));
  const todayIdx = points.findIndex((p) => p.offset === 0);
  const yFloor = y(floor);
  const yZero = y(0);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${yZero.toFixed(1)}L${x(0).toFixed(1)},${yZero.toFixed(1)}Z`;
  const breaches = points.map((p, i) => ({ p, i })).filter(({ p }) => p.offset >= 0 && floor > 0 && p.balance < floor - 0.005);

  const grid = [0.25, 0.5, 0.75, 1].map((f) => {
    const v = minV + (maxV - minV) * f;
    const gy = y(v);
    return `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,0.06)"/>
      <text x="${PAD.left + 2}" y="${(gy - 4).toFixed(1)}" fill="#6B7383" font-size="10">${esc(brlShort(v))}</text>`;
  }).join('');

  const step = points.length > 20 ? 5 : 3;
  const xLabels = points.map((p, i) => ((p.offset % step === 0) && p.offset !== 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" fill="#6B7383" font-size="10" text-anchor="middle">${dateShort(p.date)}</text>` : '')).join('');

  const xToday = x(Math.max(0, todayIdx));
  const floorLine = floor > 0
    ? `<line x1="${xToday.toFixed(1)}" x2="${(W - PAD.right).toFixed(1)}" y1="${yFloor.toFixed(1)}" y2="${yFloor.toFixed(1)}" stroke="#A3ACBB" stroke-width="1.5" stroke-dasharray="5 5"/>
       <text x="${(W - PAD.right).toFixed(1)}" y="${(yFloor - 6).toFixed(1)}" fill="#A3ACBB" font-size="10.5" text-anchor="end">Linha d'Água ${esc(brlShort(floor))}</text>`
    : '';

  const id = `w${Math.random().toString(36).slice(2, 7)}`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Onda de Liquidez: saldo real diário com a Linha d'Água">
    <defs>
      <linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00BFFF" stop-opacity="0.32"/><stop offset="1" stop-color="#00BFFF" stop-opacity="0"/></linearGradient>
      <clipPath id="${id}c"><rect x="${xToday.toFixed(1)}" y="${yFloor.toFixed(1)}" width="${(W - xToday).toFixed(1)}" height="${(H - yFloor).toFixed(1)}"/></clipPath>
    </defs>
    ${grid}
    ${minV < 0 ? `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yZero.toFixed(1)}" y2="${yZero.toFixed(1)}" stroke="rgba(255,255,255,0.22)"/>` : ''}
    <path d="${area}" fill="url(#${id}g)"/>
    ${floor > 0 ? `<path d="${line}L${x(points.length - 1).toFixed(1)},0L${x(0).toFixed(1)},0Z" fill="rgba(255,0,127,0.24)" clip-path="url(#${id}c)"/>` : ''}
    <line x1="${xToday.toFixed(1)}" x2="${xToday.toFixed(1)}" y1="${PAD.top - 6}" y2="${H - PAD.bottom}" stroke="rgba(255,255,255,0.28)" stroke-dasharray="2 3"/>
    <text x="${xToday.toFixed(1)}" y="${PAD.top - 8}" fill="#E9EDF3" font-size="10.5" text-anchor="middle" font-weight="700">hoje</text>
    ${floorLine}
    <path d="${line}" fill="none" stroke="#00BFFF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${breaches.map(({ p, i }) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.balance).toFixed(1)}" r="4" fill="#FF007F" stroke="#161920" stroke-width="2"/>`).join('')}
    <circle cx="${xToday.toFixed(1)}" cy="${y(points[todayIdx]?.balance ?? 0).toFixed(1)}" r="5" fill="#00BFFF" stroke="#161920" stroke-width="2"/>
    ${xLabels}
    <g class="cross" opacity="0"><line y1="${PAD.top}" y2="${H - PAD.bottom}" stroke="#E9EDF3" stroke-width="1"/><circle r="5" fill="#161920" stroke="#E9EDF3" stroke-width="2"/></g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/>
  </svg>`;

  container.innerHTML = `${svg}<div class="chart-tip" role="status"></div>`;
  const svgEl = container.querySelector('svg');
  const tip = container.querySelector('.chart-tip');
  const cross = svgEl.querySelector('.cross');
  const crossLine = cross.querySelector('line');
  const crossDot = cross.querySelector('circle');

  const show = (clientX) => {
    const r = svgEl.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((sx - PAD.left) / innerW) * (points.length - 1))));
    const p = points[i];
    const px = x(i);
    cross.setAttribute('opacity', '1');
    crossLine.setAttribute('x1', px);
    crossLine.setAttribute('x2', px);
    crossDot.setAttribute('cx', px);
    crossDot.setAttribute('cy', y(p.balance));
    const below = p.offset >= 0 && floor > 0 && p.balance < floor;
    const ev = p.events.slice(0, 3).map((e) => `<div class="tiny">${e.direction === 'in' ? '+' : '−'} ${esc(brl(e.amount))} · ${esc(e.note || e.category)}</div>`).join('');
    tip.innerHTML = `<div class="tiny">${esc(dateHuman(p.date))}${p.offset === 0 ? ' · hoje' : p.offset > 0 ? ' · projeção' : ''}</div>
      <b class="num">${esc(brl(p.balance))}</b>
      ${below ? `<div class="c-magenta tiny">⚠ Furo: faltam ${esc(brl(floor - p.balance))} para a Linha d'Água</div>` : ''}${ev}`;
    const left = Math.min(r.width - 80, Math.max(80, (px / W) * r.width));
    tip.style.left = `${left}px`;
    tip.classList.add('show');
  };
  const hide = () => {
    cross.setAttribute('opacity', '0');
    tip.classList.remove('show');
  };
  svgEl.addEventListener('pointermove', (e) => show(e.clientX));
  svgEl.addEventListener('pointerdown', (e) => show(e.clientX));
  svgEl.addEventListener('pointerleave', hide);
  return { breaches: breaches.length };
}

export function waveTable(points, floor) {
  const rows = points.filter((p) => p.offset >= 0).map((p) => `<tr><td>${dateShort(p.date)}</td><td class="num">${brl(p.balance)}</td><td>${floor > 0 && p.balance < floor ? '<span class="c-magenta">furo</span>' : 'ok'}</td></tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Dia</th><th>Saldo projetado</th><th>Linha d'Água</th></tr></thead><tbody>${rows}</tbody></table>`;
}
