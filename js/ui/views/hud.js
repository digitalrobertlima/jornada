// HUD Tático — Invariante Anti-Paralisia: só (a) Caixa Livre Real, (b) Alvo nº 1, (c) Horas Resgatadas.
// Dívidas em quarentena nunca entram em nenhum número desta tela.

import { esc, countUp } from '../dom.js';
import { icon } from '../icons.js';
import { brl, lifeTime, dateHuman } from '../../core/format.js';
import { minutesToWorkdays } from '../../engines/lifeHours.js';
import { ERAS } from '../../engines/eraMachine.js';

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
    ? `<button class="btn sm primary" data-act="pay" data-id="${esc(item.id)}" data-protest="1">${icon('shield')}Protesto Segurado</button>`
    : `<button class="btn sm primary" data-act="pay" data-id="${esc(item.id)}">${icon('check')}Paguei</button>`}
      <button class="btn sm" data-act="script" data-id="${esc(item.id)}">${icon('phone')}Roteiro de ligação</button>
      ${item.isProtestable ? `<button class="btn sm ghost" data-act="pay" data-id="${esc(item.id)}">Pagar parte</button>` : ''}
    </div>
  </article>`;
}

export function renderHUD(d, store) {
  const { tri, wl, cash, eras, profile, rate, coverage } = d;
  const era = ERAS[eras.currentEra - 1];
  const target = tri.target;
  const deficit = Math.max(0, wl.floor - cash);
  const coveragePct = wl.floor > 0 ? Math.min(100, (cash / wl.floor) * 100) : 100;
  const workdays = minutesToWorkdays(profile.rescuedLifeMinutes, profile);
  const shrinking = tri.battlefield.find((i) => i.alerts.some((a) => a.kind === 'limitShrinking'));
  const missions = tri.frontline.filter((i) => i !== target);

  const demo = store.meta.demo
    ? `<div class="demo-banner"><span>${icon('info')} Modo demonstração — dados fictícios</span><button class="btn sm ghost" data-act="demo-clear">Limpar tudo</button></div>` : '';

  const eraDots = eras.eras.map((e) => {
    const cls = e.done ? 'on' : e.n === eras.currentEra ? 'cur' : '';
    return `<i class="${cls}" style="--p:${Math.round(e.progress * 100)}%"></i>`;
  }).join('');

  const targetHTML = target ? `
    <section class="card target-card glow-${target.zone === 'frontline' ? 'magenta' : 'cyan'}" aria-labelledby="t-alvo">
      <div class="row between"><span class="eyebrow" id="t-alvo">${icon('target', 'c-magenta')} Alvo prioritário nº 1</span>
        <span class="pill">${target.zone === 'frontline' ? 'Zona 1' : target.zone === 'battlefield' ? 'Zona 2' : 'Zona 3'}</span></div>
      <div class="beneficiary" style="margin-top:10px">${esc(target.ob.beneficiary)}</div>
      <div class="small" style="margin-top:2px">${esc(target.reason)}</div>
      <div class="row between" style="margin-top:12px;align-items:flex-end">
        <div><div class="mid num">${brl(target.dueNow)}</div><div class="tiny">${target.ob.isShared ? 'sua cota · ' : ''}= ${lifeCost(target.dueNow, rate)} da sua vida</div></div>
        ${(() => {
    const dl = deadlineOf(target);
    if (!dl) return '';
    const cd = countdownText(dl.date);
    return `<div class="countdown" style="text-align:right;flex-direction:column;align-items:flex-end"><span class="tiny">${dl.kind === 'cartório' ? 'até o cartório' : cd.late ? 'atrasado' : 'para vencer'}</span><b class="num${cd.hot ? ' c-magenta' : ''}" data-deadline="${dl.date}">${cd.text}</b></div>`;
  })()}
      </div>
      <div class="actions row wrap" style="margin-top:14px;gap:8px">
        ${target.isProtestable
    ? `<button class="btn primary sm" data-act="pay" data-id="${esc(target.id)}" data-protest="1">${icon('shield')}Protesto Segurado</button>`
    : `<button class="btn primary sm" data-act="pay" data-id="${esc(target.id)}">${icon('check')}Paguei</button>`}
        <button class="btn sm" data-act="script" data-id="${esc(target.id)}">${icon('phone')}Roteiro</button>
        <button class="btn sm ghost" data-act="obligation-open" data-id="${esc(target.id)}">Detalhes</button>
      </div>
    </section>` : `
    <section class="card glow-cyan">
      <span class="eyebrow">Alvo prioritário nº 1</span>
      <p style="margin:10px 0 12px">Nenhum alvo na mira. Cadastre aluguel, contas e dívidas para a triagem montar sua ordem de ataque.</p>
      <button class="btn primary" data-act="goto" data-tab="battle">${icon('plus')}Cadastrar contas e dívidas</button>
    </section>`;

  const coverageHTML = coverage ? `
    <section class="card tight">
      <div class="row between"><span class="eyebrow">${icon('home')} ${esc(store.state.household?.name || 'Casa')}</span>
        <span class="small num">${Math.round(coverage.ratio * 100)}% coberto</span></div>
      <div class="meter" style="margin:10px 0"><i style="width:${Math.round(coverage.ratio * 100)}%"></i></div>
      ${coverage.rows.map((r) => `<div class="small" style="margin-bottom:4px"><b>${esc(r.ob.beneficiary)}</b> · ${brl(r.total)}</div>
        <div class="coverage-row">${r.shares.map((s) => `<span>${s.ok ? icon('check', 'c-cyan') : icon('alert', 'c-amber')} ${esc(s.name)}</span>
          <span class="num ${s.ok ? 'c-cyan' : ''}">${s.paid >= s.share - 0.01 ? 'pago' : `${brl(s.covered)} de ${brl(s.share)}`}</span>`).join('')}</div>`).join('<div style="height:8px"></div>')}
    </section>` : '';

  return `<div class="stack">
    ${demo}
    <div class="era-strip">
      <span class="label">Era ${era.roman} · ${esc(era.name)}</span>
      <div class="era-dots" aria-hidden="true">${eraDots}</div>
    </div>

    <section class="card hero-cash" aria-labelledby="t-caixa">
      <span class="eyebrow" id="t-caixa">Caixa livre real hoje</span>
      <div class="big num" style="margin-top:6px" data-count="${cash}" data-fmt="brl">${brl(cash)}</div>
      <div class="tiny" style="margin-top:4px">Só dinheiro de verdade: limite, benefício e garantia ficam de fora.</div>
      <div class="waterline-line">
        ${icon('drop', deficit > 0 ? 'c-magenta' : 'c-cyan')}
        <span class="grow">Linha d'Água (15 dias): <b class="num">${brl(wl.floor)}</b></span>
        <span class="num ${deficit > 0 ? 'c-magenta' : 'c-cyan'}"><b>${deficit > 0 ? `faltam ${brl(deficit)}` : `folga ${brl(cash - wl.floor)}`}</b></span>
      </div>
      <div class="meter${deficit > 0 ? ' magenta' : ''}" style="margin-top:8px"><i style="width:${coveragePct}%"></i></div>
    </section>

    <section class="card life" aria-labelledby="t-horas">
      <div class="row between">
        <div>
          <span class="eyebrow" id="t-horas">${icon('hourglass', 'c-cyan')} Horas de vida resgatadas</span>
          <div class="mid num" style="margin-top:6px" data-count="${profile.rescuedLifeMinutes}" data-fmt="life">${lifeTime(profile.rescuedLifeMinutes)}</div>
          <div class="tiny">≈ ${workdays.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias de trabalho · sua hora real vale ${brl(rate)}</div>
        </div>
      </div>
    </section>

    ${targetHTML}

    <button class="cta-caiu" type="button" data-act="caiu">
      ${icon('bolt')}<span><b>Caiu dinheiro?</b><span class="small">Simule onde cada real rende mais antes de gastar.</span></span>
    </button>

    ${shrinking && (deficit > 0 || tri.frontline.length) ? `<div class="alert">${icon('alert')}<div><b>${esc(shrinking.ob.beneficiary)}:</b> ${esc(shrinking.alerts[0].text)}</div></div>` : ''}

    ${coverageHTML}

    ${missions.length ? `<div class="section-title"><h2>Missões da Linha de Frente</h2><span class="eyebrow">${missions.length}</span></div>
      ${missions.map((m) => missionCard(m, { rate })).join('')}` : ''}

    ${tri.quarantine.length ? `<button class="card tight row" type="button" data-act="goto" data-tab="battle" style="text-align:left;color:inherit;width:100%">
      ${icon('dome', 'c-ink3')}<span class="small grow">Domo de Quarentena: ${tri.quarantine.length} dívida${tri.quarantine.length > 1 ? 's' : ''} antiga${tri.quarantine.length > 1 ? 's' : ''} selada${tri.quarantine.length > 1 ? 's' : ''}, fora do seu radar até a Era III. Não entram em nenhum número desta tela.</span></button>` : ''}
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
