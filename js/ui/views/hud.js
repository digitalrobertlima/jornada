// HUD Tático — Invariante Anti-Paralisia: só (a) Caixa Livre Real, (b) Alvo nº 1, (c) Horas Resgatadas.
// Dívidas em quarentena nunca entram em nenhum número desta tela.

import { esc, countUp } from '../dom.js';
import { icon } from '../icons.js';
import { brl, lifeTime, dateHuman } from '../../core/format.js';
import { minutesToWorkdays } from '../../engines/lifeHours.js';
import { ERAS } from '../../engines/eraMachine.js';
import { buildGuide, closedDebts } from '../../engines/guide.js';

export function deadlineOf(item) {
  if (item.isProtestable && item.ob.rules?.protestDeadline) return { date: item.ob.rules.protestDeadline, kind: 'cartório' };
  if (item.ob.dueDate) return { date: item.ob.dueDate, kind: 'vencimento' };
  return null;
}

/** "3d 14h" até 23:59 do dia-limite (hora local). */
export function countdownText(dateISO, now = new Date()) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59);
  const ms = end - now;
  if (ms < 0) {
    const days = Math.ceil(-ms / 86400000);
    return { text: days <= 1 ? 'venceu ontem' : `há ${days} dias`, late: true, hot: true };
  }
  const h = Math.floor(ms / 3600000);
  const days = Math.floor(h / 24);
  const hours = h % 24;
  return { text: days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((ms % 3600000) / 60000)}min`, late: false, hot: days < 3 };
}

function lifeCost(amount, rate) {
  return rate > 0 ? lifeTime((amount / rate) * 60) : '—';
}

export function missionCard(item, { rate, isTarget = false }) {
  const dl = deadlineOf(item);
  const cd = dl ? countdownText(dl.date) : null;
  const shared = item.ob.isShared ? '<span class="pill">sua cota</span>' : '';
  return `<article class="card mission${item.isVital ? ' vital' : ''}${isTarget ? ' glow-magenta' : ''}">
    <div class="head">
      <div class="grow">
        <div class="title">${esc(item.ob.beneficiary)}</div>
        <div class="row wrap" style="gap:6px;margin-top:6px">
          <span class="pill ${item.isProtestable ? 'magenta' : 'cyan'}">${esc(item.reason)}</span>${shared}
          ${item.installment ? `<span class="pill">${esc(item.installment.label)}</span>` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div class="amount num">${brl(item.dueNow)}</div>
        <div class="tiny">= ${lifeCost(item.dueNow, rate)} de vida</div>
      </div>
    </div>
    ${cd ? `<div class="row" style="margin-top:10px;gap:6px">${icon('clock')}
      <span class="small">${dl.kind === 'cartório' ? 'Prazo do cartório' : 'Vence'} ${esc(dateHuman(dl.date))} ·</span>
      <span class="clock${cd.hot ? ' hot' : ''} num" data-deadline="${dl.date}">${cd.text}</span></div>` : ''}
    ${item.late > 0 && item.updated > item.open ? `<div class="small c-magenta" style="margin-top:6px">Atraso já somou ${brl(item.updated - item.open)} em multa e juros.</div>` : ''}
    <div class="actions">
      ${item.isProtestable
    ? `<button class="btn sm primary" data-act="pay" data-id="${esc(item.id)}" data-protest="1">${icon('shield')}Paguei antes do cartório</button>`
    : `<button class="btn sm primary" data-act="pay" data-id="${esc(item.id)}">${icon('check')}Paguei</button>`}
      <button class="btn sm" data-act="script" data-id="${esc(item.id)}">${icon('phone')}Roteiro de ligação</button>
      ${item.isProtestable ? `<button class="btn sm ghost" data-act="pay" data-id="${esc(item.id)}">Pagar parte</button>` : ''}
    </div>
  </article>`;
}

function guideButton(a) {
  const attrs = [`data-act="${a.act}"`];
  if (a.id) attrs.push(`data-id="${esc(a.id)}"`);
  if (a.protest) attrs.push('data-protest="1"');
  if (a.settle) attrs.push('data-settle="1"');
  if (a.kind) attrs.push(`data-kind="${a.kind}"`);
  if (a.tab) attrs.push(`data-tab="${a.tab}"`);
  if (a.debt) attrs.push(`data-debt="${esc(a.debt)}"`);
  return `<button type="button" class="btn sm${a.primary ? ' primary' : ''}" ${attrs.join(' ')}>${esc(a.label)}</button>`;
}

const TONE_ICON = { urgent: 'alert', warn: 'alert', win: 'spark', info: 'info' };

function guideHero(step) {
  return `<section class="card guide-hero tone-${step.tone}" aria-labelledby="g-title">
    <span class="eyebrow">${icon(TONE_ICON[step.tone])} Seu próximo passo</span>
    <h2 id="g-title" class="guide-title">${esc(step.title)}</h2>
    <p class="small guide-why">${esc(step.why)}</p>
    <div class="row wrap" style="gap:8px;margin-top:14px">${step.actions.map(guideButton).join('')}</div>
  </section>`;
}

function guideRow(step, n) {
  return `<div class="guide-row tone-${step.tone}">
    <span class="guide-n">${n}</span>
    <div class="grow"><b>${esc(step.title)}</b><div class="tiny">${esc(step.why)}</div>
      <div class="row wrap" style="gap:6px;margin-top:8px">${step.actions.slice(0, 2).map((a) => guideButton({ ...a, primary: false })).join('')}</div></div>
  </div>`;
}

export function renderHUD(d, store) {
  const { tri, wl, cash, eras, profile, rate, coverage } = d;
  const era = ERAS[eras.currentEra - 1];
  const deficit = Math.max(0, wl.floor - cash);
  const coveragePct = wl.floor > 0 ? Math.min(100, (cash / wl.floor) * 100) : 100;
  const workdays = minutesToWorkdays(profile.rescuedLifeMinutes, profile);
  const steps = buildGuide(d, { state: store.state, today: d.today });
  const closed = closedDebts(store.state, d.pid);

  const demo = store.meta.demo
    ? `<div class="demo-banner"><span>${icon('info')} Modo demonstração — dados fictícios</span><button class="btn sm ghost" data-act="demo-clear">Limpar tudo</button></div>` : '';

  const eraDots = eras.eras.map((e) => {
    const cls = e.done ? 'on' : e.n === eras.currentEra ? 'cur' : '';
    return `<i class="${cls}" style="--p:${Math.round(e.progress * 100)}%"></i>`;
  }).join('');

  const coverageHTML = coverage ? `
    <section class="card tight">
      <div class="row between"><span class="eyebrow">${icon('home')} ${esc(store.state.household?.name || 'Casa')} · contas divididas</span>
        <span class="small num">${Math.round(coverage.ratio * 100)}% coberto</span></div>
      <div class="meter" style="margin:10px 0"><i style="width:${Math.round(coverage.ratio * 100)}%"></i></div>
      ${coverage.rows.map((r) => `<div class="small" style="margin-bottom:4px"><b>${esc(r.ob.beneficiary)}</b> · ${brl(r.total)}</div>
        <div class="coverage-row">${r.shares.map((s) => `<span>${s.ok ? icon('check', 'c-cyan') : icon('alert', 'c-amber')} ${esc(s.name)}</span>
          <span class="num ${s.ok ? 'c-cyan' : ''}">${s.paid >= s.share - 0.01 ? 'pago' : `${brl(s.covered)} de ${brl(s.share)}`}</span>`).join('')}</div>`).join('<div style="height:8px"></div>')}
    </section>` : '';

  return `<div class="stack">
    ${demo}
    <button type="button" class="era-strip tap" data-act="goto" data-tab="vault" title="${esc(era.goal)}">
      <span class="label">Fase ${eras.currentEra} de 4 · ${esc(era.name)}</span>
      <div class="era-dots" aria-hidden="true">${eraDots}</div>${icon('chev', 'chev-r')}
    </button>

    ${steps.length ? guideHero(steps[0]) : ''}

    <div class="grid-2">
      <button type="button" class="card tight hero-cash tap" data-act="goto" data-tab="wallet">
        <span class="eyebrow">Dinheiro hoje ›</span>
        <div class="mid num" style="margin-top:4px" data-count="${cash}" data-fmt="brl">${brl(cash)}</div>
        <div class="tiny">só conta e dinheiro vivo</div>
      </button>
      <button type="button" class="card tight life tap" data-act="victories">
        <span class="eyebrow">Vitórias ›</span>
        <div class="mid num" style="margin-top:4px" data-count="${profile.rescuedLifeMinutes}" data-fmt="life">${lifeTime(profile.rescuedLifeMinutes)}</div>
        <div class="tiny">de vida resgatadas${closed ? ` · ${closed} ${closed === 1 ? 'dívida quitada' : 'dívidas quitadas'}` : ''}</div>
      </button>
    </div>

    <button type="button" class="card tight tap" data-act="essentials">
      <div class="row between"><span class="small">${icon('drop', deficit > 0 ? 'c-magenta' : 'c-cyan')} Contas essenciais dos próximos 15 dias</span><b class="num">${brl(wl.floor)}</b></div>
      <div class="meter${deficit > 0 ? ' magenta' : ''}" style="margin:8px 0 6px"><i style="width:${coveragePct}%"></i></div>
      <div class="tiny ${deficit > 0 ? 'c-magenta' : 'c-cyan'}">${deficit > 0 ? `Faltam ${brl(deficit)} — esse dinheiro não deve ir para outras dívidas.` : `Cobertas. Sobram ${brl(cash - wl.floor)} na conta.`}</div>
      <div class="tiny c-ink3" style="margin-top:4px">${wl.items.length} ${wl.items.length === 1 ? 'conta' : 'contas'} · toque para ver e pagar ›</div>
    </button>

    <button class="cta-caiu" type="button" data-act="caiu">
      ${icon('bolt')}<span><b>Entrou dinheiro?</b><span class="small">Registre e decida com calma se vai pagar alguma conta.</span></span>
    </button>

    ${steps.length > 1 ? `<section class="card">
      <span class="eyebrow">Depois disso</span>
      <div class="stack" style="gap:0;margin-top:8px">${steps.slice(1, 3).map((s, k) => guideRow(s, k + 2)).join('')}</div>
      ${steps.length > 3 ? `<details class="more"><summary class="small">Ver mais ${steps.length - 3} ${steps.length - 3 === 1 ? 'passo' : 'passos'}</summary>
        <div class="stack" style="gap:0">${steps.slice(3).map((s, k) => guideRow(s, k + 4)).join('')}</div></details>` : ''}
    </section>` : ''}

    ${coverageHTML}

    ${tri.quarantine.length ? `<button class="card tight row" type="button" data-act="goto" data-tab="battle" style="text-align:left;color:inherit;width:100%">
      ${icon('dome', 'c-ink3')}<span class="small grow">${tri.quarantine.length} ${tri.quarantine.length > 1 ? 'dívidas antigas guardadas' : 'dívida antiga guardada'} para depois. Elas não entram em nenhum número desta tela — uma batalha de cada vez.</span></button>` : ''}
  </div>`;
}

export function mountHUD(root, d, prev) {
  const cashEl = root.querySelector('[data-fmt="brl"][data-count]');
  if (cashEl && prev && prev.cash !== d.cash) countUp(cashEl, prev.cash, d.cash, brl);
  const lifeEl = root.querySelector('[data-fmt="life"][data-count]');
  if (lifeEl && prev && prev.life !== d.profile.rescuedLifeMinutes) countUp(lifeEl, prev.life, d.profile.rescuedLifeMinutes, lifeTime, 1400);
}

/** Atualiza contadores regressivos a cada minuto. */
export function tickCountdowns(root) {
  for (const el of root.querySelectorAll('[data-deadline]')) {
    const cd = countdownText(el.dataset.deadline);
    el.textContent = cd.text;
  }
}
