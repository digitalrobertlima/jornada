// Carteira & Onda — deck 3D de contas, Onda de Liquidez e lançamento rápido.

import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { brl, dateShort } from '../../core/format.js';
import { renderDeck, bindDeck } from '../deck3d.js';
import { renderWave, waveTable } from '../flowChart.js';
import { liquidityWave } from '../../engines/cashflow.js';
import { forecastCardHTML } from '../forecast.js';

export function renderWallet(d, store) {
  const accounts = store.state.accounts.filter((a) => a.profileId === d.pid);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entries = store.state.ledger
    .filter((e) => e.profileId === d.pid)
    .sort((a, b) => (b.date.localeCompare(a.date)) || String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)))
    .slice(0, 60);
  const { liq, wl } = d;

  const rows = entries.map((e) => {
    const acc = accById.get(e.accountId);
    const [, m, day] = e.date.split('-');
    const cls = e.direction === 'in' ? 'in' : e.impactCashToday ? '' : 'nocash';
    return `<button type="button" class="tx tap" data-act="entry-open" data-id="${esc(e.id)}">
      <div class="day"><b>${day}</b>${m}</div>
      <div class="what"><div>${esc(e.note || e.category)}</div>
        <div class="tiny">${esc(acc?.name || 'sem conta')} · ${esc(e.category)}${e.status === 'scheduled' ? ' · <span class="c-amber">agendado</span>' : ''}${!e.impactCashToday ? ' · não mexe no caixa' : ''}${e.installments > 1 ? ` · ${e.installments}x` : ''}</div></div>
      <div class="val ${cls} num">${e.direction === 'in' ? '+' : '−'}${brl(e.amount)}<br><span class="tiny c-ink3">›</span></div>
    </button>`;
  }).join('');

  return `<div class="stack">
    <div class="section-title"><h2>Contas & Cartões</h2><div class="row" style="gap:6px"><button class="btn sm" data-act="move-open">⇄ Mover saldo</button><button class="btn sm ghost" data-act="account-new">${icon('plus')}Conta</button></div></div>
    ${renderDeck(accounts)}

    <div class="liq-chips">
      <div class="liq-chip real"><span class="tiny">Liquidez real</span><b class="num">${brl(liq.real)}</b></div>
      ${liq.savings > 0 ? `<div class="liq-chip"><span class="tiny">Cofrinhos (rendendo)</span><b class="num">${brl(liq.savings)}</b></div>` : ''}
      <div class="liq-chip"><span class="tiny">Benefício (restrito)</span><b class="num">${brl(liq.benefit)}</b></div>
      <div class="liq-chip"><span class="tiny">Limite de crédito</span><b class="num">${brl(liq.creditAvailable)}</b></div>
      <div class="liq-chip"><span class="tiny">Garantia livre / travada</span><b class="num">${brl(liq.collateralFree)} <span class="tiny">/ ${brl(liq.collateralLocked)}</span></b></div>
    </div>
    <p class="tiny">Só a liquidez real paga aluguel, boleto e conta de luz. O resto nunca é tratado como dinheiro sobrando.</p>

    <section class="card" aria-labelledby="t-onda">
      <div class="row between"><h2 id="t-onda" style="font-size:15px">Seu dinheiro, dia a dia</h2><span class="eyebrow">14 dias atrás · 15 à frente</span></div>
      <div class="chart-wrap" id="wave"></div>
      <div class="chart-legend">
        <span><i></i>Saldo real (entradas e saídas agendadas)</span>
        <span><i class="dash"></i>Contas essenciais (15 dias) ${brl(wl.floor)}</span>
        <span><i class="dot"></i>Dia em que falta dinheiro</span>
      </div>
      <details style="margin-top:8px"><summary class="tiny" style="cursor:pointer">Ver como tabela</summary><div id="wave-table"></div></details>
    </section>

    ${forecastCardHTML(d)}

    <div class="quick-entry">
      <button class="btn in" data-act="entry-new" data-dir="in">+ <span>Entrou</span></button>
      <button class="btn out" data-act="entry-new" data-dir="out">− <span>Saiu</span></button>
    </div>

    <section class="card">
      <div class="row between"><h2 style="font-size:15px">Fluxo diário</h2><span class="eyebrow">${entries.length} lançamentos</span></div>
      <div class="ledger-list">${rows || '<div class="empty">Nada lançado ainda. Use + e − para registrar o que entra e o que sai.</div>'}</div>
    </section>
  </div>`;
}

export function mountWallet(root, d, store) {
  bindDeck(root);
  const points = liquidityWave(store.state, d.pid, d.today);
  const host = root.querySelector('#wave');
  const draw = () => renderWave(host, points, { floor: d.wl.floor, today: d.today });
  draw();
  root.querySelector('#wave-table').innerHTML = waveTable(points, d.wl.floor);
  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (host.isConnected) draw(); });
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

export { dateShort };
