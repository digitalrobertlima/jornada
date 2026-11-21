// 3D com propósito cognitivo (CSS 3D, acelerado por GPU):
//  1. Deck em leque das contas e cartões — toque traz para frente, segundo toque vira o cartão.
//  2. Totens volumétricos da dívida — base sólida (principal) + topo translúcido pulsante (juros, multa, cartório).

import { esc } from './dom.js';
import { brl, brlShort, lifeTime, dateShort } from '../core/format.js';
import { ACCOUNT_TYPES } from '../core/model.js';
import { icon } from './icons.js';

// ---------------------------------------------------------------- Deck

function cardFront(a) {
  const type = ACCOUNT_TYPES[a.type];
  let main = '';
  let sub = '';
  switch (a.type) {
    case 'checking_cash':
      main = `<div class="val cyan num">${brl(a.balance)}</div>`;
      sub = 'Dinheiro de verdade · paga as contas essenciais';
      break;
    case 'benefit_card':
      main = `<div class="val num">${brl(a.balance)}</div>`;
      sub = 'Saldo restrito · não paga boleto nem aluguel';
      break;
    case 'savings_pot':
      main = `<div class="val num">${brl(a.balance)}</div>`;
      sub = `Guardado · rende ${a.cdiPercent ?? 100}% do CDI · resgate quando quiser`;
      break;
    case 'credit_card':
      main = `<div class="val num">${brl(a.limitAvailable)}</div>`;
      sub = `disponível de ${brl(a.limitTotal)}${a.dueDay ? ` · vence dia ${a.dueDay}` : ''}`;
      break;
    case 'collateralized_yield_crypto': {
      const total = Math.max(1, a.collateralTotal);
      const lockedPct = Math.min(100, (a.lockedInstallments / total) * 100);
      main = `<div><div class="val num">${brl(a.limitAvailable)}</div>
        <div class="collat-bar" aria-hidden="true" style="margin-top:6px"><span class="locked" style="width:${lockedPct}%"></span><span class="free" style="flex:1"></span></div></div>`;
      sub = `livre · ${brl(a.lockedInstallments)} travado em parcelas`;
      break;
    }
    default:
      break;
  }
  const badge = a.type === 'credit_card' && a.limitShrinking
    ? `<span class="pill magenta">${icon('alert')}Corte de limite</span>`
    : a.type === 'checking_cash' ? '<span class="pill cyan">Real</span>'
      : a.type === 'savings_pot' ? `<span class="pill cyan">${a.cdiPercent ?? 100}% CDI</span>`
      : a.type === 'collateralized_yield_crypto' ? `<span class="pill cyan">${icon('btc')}${a.yieldConfig?.cdiPercent ?? 100}% CDI</span>`
        : '<span class="chip"></span>';
  return `<div class="face front">
    <div class="top"><div><div class="tp">${esc(type?.short || '')}</div><div class="nm">${esc(a.name)}</div></div>${badge}</div>
    ${main}
    <div class="sub">${sub}</div>
  </div>`;
}

function cardBack(a) {
  const rows = [];
  if (a.type === 'checking_cash') rows.push(['Saldo', brl(a.balance)]);
  if (a.type === 'benefit_card') rows.push(['Saldo restrito', brl(a.balance)], ['Conta como liquidez?', 'Não']);
  if (a.type === 'savings_pot') rows.push(['Guardado', brl(a.balance)], ['Rende', `${a.cdiPercent ?? 100}% do CDI`], ['Conta como liquidez?', 'Só depois de mover para o Pix']);
  if (a.type === 'credit_card') {
    rows.push(['Limite total', brl(a.limitTotal)], ['Disponível', brl(a.limitAvailable)], ['Em uso', brl(Math.max(0, a.limitTotal - a.limitAvailable))]);
    if (a.closingDay) rows.push(['Fecha / vence', `dia ${a.closingDay} / dia ${a.dueDay || '—'}`]);
    if (a.limitShrinking) rows.push(['Alerta', '<span class="c-magenta">pagar não devolve limite</span>']);
  }
  if (a.type === 'collateralized_yield_crypto') {
    rows.push(['Garantia total', brl(a.collateralTotal)], ['Travada em parcelas', brl(a.lockedInstallments)], ['Limite livre', brl(a.limitAvailable)],
      ['Sats rendimento + cashback', `${Math.floor((a.satsFromYield || 0) + (a.satsFromCashback || 0)).toLocaleString('pt-BR')}`]);
  }
  return `<div class="face back">
    <div class="row between"><b>${esc(a.name)}</b><span class="tiny">toque para virar</span></div>
    ${rows.map(([k, v]) => `<div class="row between"><span class="c-ink2">${k}</span><span class="num">${v}</span></div>`).join('')}
    <div class="row" style="margin-top:auto;gap:6px">
      <span class="btn sm" data-act="account-edit" data-id="${esc(a.id)}" role="button" tabindex="0">${icon('edit')}Editar</span>
      ${['checking_cash', 'savings_pot', 'collateralized_yield_crypto'].includes(a.type) ? `<span class="btn sm" data-act="move-open" data-from="${esc(a.id)}" role="button" tabindex="0">⇄ Mover</span>` : ''}
      <span class="btn sm" data-act="entry-new" data-account="${esc(a.id)}" data-dir="out" role="button" tabindex="0">${icon('minus')}Gasto</span>
    </div>
  </div>`;
}

export function renderDeck(accounts) {
  if (!accounts.length) {
    return `<div class="empty">Nenhuma conta ainda. Comece pela sua conta corrente: é ela que conta como dinheiro de verdade.</div>`;
  }
  // carrossel: arrasta para o lado, um cartão por vez; a conta corrente (dinheiro de verdade) vem primeiro
  const order = [...accounts].sort((a, b) => (b.type === 'checking_cash') - (a.type === 'checking_cash'));
  const cards = order.map((a, i) => `<button type="button" class="acard t-${a.type}${a.limitShrinking ? ' shrinking' : ''}${i === 0 ? ' current' : ''}" data-card="${esc(a.id)}"
      aria-label="${esc(a.name)} (${i + 1} de ${order.length})"><div class="flip">${cardFront(a)}${cardBack(a)}</div></button>`).join('');
  const dots = order.length > 1 ? `<div class="deck-dots" aria-hidden="true">${order.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>` : '';
  return `<div class="deck" id="deck">${cards}</div>${dots}<div class="deck-hint">Arraste para o lado para ver os outros · toque para virar o cartão</div>`;
}

export function bindDeck(root) {
  const deck = root.querySelector('#deck');
  if (!deck) return;
  const cards = [...deck.querySelectorAll('.acard')];
  const dots = [...(root.querySelector('.deck-dots')?.children || [])];
  let current = 0;
  const update = () => {
    const mid = deck.scrollLeft + deck.clientWidth / 2;
    let best = 0;
    let dist = Infinity;
    cards.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = i; }
    });
    if (best === current) return;
    cards[current]?.classList.remove('current', 'flipped');
    dots[current]?.classList.remove('on');
    current = best;
    cards[current].classList.add('current');
    dots[current]?.classList.add('on');
  };
  let raf = 0;
  deck.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
  deck.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')) return; // ações do verso
    const card = e.target.closest('.acard');
    if (!card) return;
    const i = cards.indexOf(card);
    if (i !== current) { card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); return; }
    card.classList.toggle('flipped');
  });
  dots.forEach((d, i) => d.addEventListener('click', () => cards[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })));
}

// ---------------------------------------------------------------- Totens

const MAX_H = 150;
const MIN_H = 12;

/** Alturas da base (principal) e do topo (risco) em px, escala raiz para dívidas pequenas aparecerem. */
export function totemHeights(principal, risk, maxValue) {
  const total = Math.max(0, principal) + Math.max(0, risk);
  if (total <= 0 || maxValue <= 0) return { hb: 0, ht: 0 };
  const H = Math.max(MIN_H, MAX_H * Math.sqrt(Math.min(1, total / maxValue)));
  const hb = H * (Math.max(0, principal) / total);
  return { hb: Math.round(hb), ht: Math.round(H - hb) };
}

/** Altura "cheia" da torre: parcelada usa o valor original (todas as parcelas), para as pagas continuarem visíveis. */
export function towerValue(item) {
  const inst = item.installment;
  if (inst?.total >= 2) return Math.max(item.principalPart, inst.amount * inst.total);
  return item.principalPart;
}

/** Torre de blocos: um bloco por parcela (até 12), pagas em ciano, a pagar em cinza, juros em magenta no topo. */
function segmentedSceneHTML(item, maxValue) {
  const inst = item.installment;
  const blocks = Math.min(12, inst.total);
  const paidBlocks = inst.total > 12 ? Math.round((inst.paid / inst.total) * blocks) : inst.paid;
  const { hb, ht } = totemHeights(towerValue(item), item.riskLayer, maxValue);
  const gap = 3;
  const h = Math.max(6, (hb - gap * (blocks - 1)) / blocks);
  let html = '<div class="scene tower" aria-hidden="true">';
  for (let k = 0; k < blocks; k++) {
    const paid = k < paidBlocks;
    html += `<div class="prism ${paid ? 'paid' : 'base'}" data-k="${k}" style="height:${h.toFixed(1)}px;bottom:${(k * (h + gap)).toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div>`;
  }
  const top = blocks * (h + gap) - gap;
  html += `<div class="prism risk${ht > 0 ? '' : ' none'}" style="height:${ht}px;bottom:${top.toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div></div>`;
  return { html, paidBlocks };
}

/** Torre do cartão: a fatura à vista na base + um bloco por parcela de cada compra parcelada, tudo na mesma torre. */
function groupSceneHTML(item, maxValue) {
  const { hb, ht } = totemHeights(item.principalPart, item.riskLayer, maxValue);
  const gap = 3;
  let html = '<div class="scene tower" aria-hidden="true">';
  let bottom = 0;
  let k = 0;
  let paidBlocks = 0;
  for (const m of item.group) {
    const share = Math.max(6, hb * (towerValue(m) / Math.max(1, item.principalPart)));
    if (m.installment?.total >= 2) {
      const blocks = Math.min(12, m.installment.total);
      const paid = m.installment.total > 12 ? Math.round((m.installment.paid / m.installment.total) * blocks) : m.installment.paid;
      const h = Math.max(5, (share - gap * (blocks - 1)) / blocks);
      for (let j = 0; j < blocks; j++, k++) {
        if (j < paid) paidBlocks++;
        html += `<div class="prism ${j < paid ? 'paid' : 'base'}" data-k="${k}" style="height:${h.toFixed(1)}px;bottom:${(bottom + j * (h + gap)).toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div>`;
      }
      bottom += blocks * (h + gap);
    } else {
      html += `<div class="prism base" data-k="${k++}" style="height:${share.toFixed(1)}px;bottom:${bottom.toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div>`;
      bottom += share + gap;
    }
  }
  const top = Math.max(0, bottom - gap);
  html += `<div class="prism risk${ht > 0 ? '' : ' none'}" style="height:${ht}px;bottom:${top.toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div></div>`;
  return { html, paidBlocks };
}

export function totemSceneHTML({ hb, ht }) {
  return `<div class="scene" aria-hidden="true">
    <div class="prism base" style="--h:${hb}px;height:${hb}px"><i class="b"></i><i class="s"></i><i class="f"></i>${ht > 0 ? '' : '<i class="t"></i>'}</div>
    <div class="prism risk${ht > 0 ? '' : ' none'}" style="height:${ht}px;bottom:${hb}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div>
  </div>`;
}

export function setTotem(sceneEl, { hb, ht }) {
  if (!sceneEl) return;
  const base = sceneEl.querySelector('.prism.base');
  const risk = sceneEl.querySelector('.prism.risk');
  base.style.height = `${hb}px`;
  risk.style.height = `${ht}px`;
  risk.style.bottom = `${hb}px`;
  risk.classList.toggle('none', ht <= 0);
}

/** Barra de progresso das parcelas: um segmento por parcela (até 12), contínua acima disso. */
export function installmentBar(inst) {
  if (!inst?.total) return '';
  const label = `${inst.paid} de ${inst.total} parcelas pagas`;
  if (inst.total > 12) {
    return `<div class="inst-bar cont" role="img" aria-label="${label}"><i class="on" style="width:${Math.round((inst.paid / inst.total) * 100)}%"></i></div>`;
  }
  const segs = Array.from({ length: inst.total }, (_, k) => `<i class="${k < inst.paid ? 'on' : k === inst.paid ? 'cur' : ''}"></i>`).join('');
  return `<div class="inst-bar" role="img" aria-label="${label}">${segs}</div>`;
}

// ---------------------------------------------------------------- Simulação (o que vai entrar)

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthShort = (iso) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

const prismHTML = (cls, h, bottom, k = null) => (h < 0.5 ? '' : `<div class="prism ${cls}"${k != null ? ` data-k="${k}"` : ''} style="height:${Math.max(0, h).toFixed(1)}px;bottom:${bottom.toFixed(1)}px"><i class="b"></i><i class="s"></i><i class="f"></i><i class="t"></i></div>`);

/** Torre na simulação: já pago (ciano) · o dinheiro previsto paga (verde) · ainda falta (fantasma). */
function simSceneHTML(item, sim, maxValue) {
  const inst = item.installment;
  const { hb } = totemHeights(towerValue(item), 0, maxValue);
  let html = '<div class="scene tower sim" aria-hidden="true">';
  if (sim.later) return `${html}${prismHTML('later', hb, 0)}</div>`;
  if (inst?.total >= 2) {
    const blocks = Math.min(12, inst.total);
    const scale = blocks / inst.total;
    const paidBlocks = Math.round(inst.paid * scale);
    const planInst = sim.done ? inst.total - inst.paid : Math.floor((sim.paid + 0.01) / Math.max(0.01, inst.amount));
    const planBlocks = Math.min(blocks - paidBlocks, Math.round(planInst * scale) || (sim.paid > 0 && !sim.done ? 1 : 0));
    const gap = 3;
    const h = Math.max(6, (hb - gap * (blocks - 1)) / blocks);
    for (let k = 0; k < blocks; k++) {
      const cls = k < paidBlocks ? 'paid' : k < paidBlocks + planBlocks ? 'plan' : 'ghost';
      html += prismHTML(cls, h, k * (h + gap), k);
    }
  } else {
    const total = sim.paid + sim.left;
    const fp = total > 0 ? Math.min(1, sim.paid / total) : 1;
    const hp = sim.done ? hb : hb * fp;
    html += prismHTML('plan', hp, 0);
    if (!sim.done) html += prismHTML('ghost', hb - hp, hp);
  }
  return `${html}</div>`;
}

/** Torre de dinheiro que sobra (ou buraco, se faltar para as essenciais). */
export function moneyTowerHTML({ leftover, reserve, maxValue, until }) {
  const short = leftover < 0;
  const { hb } = totemHeights(Math.abs(leftover), 0, maxValue);
  const blocks = Math.max(1, Math.min(8, Math.ceil(hb / 18)));
  const gap = 3;
  const h = Math.max(6, (hb - gap * (blocks - 1)) / blocks);
  let scene = `<div class="scene tower sim" aria-hidden="true">`;
  for (let k = 0; k < blocks; k++) scene += prismHTML(short ? 'ghost' : 'money', h, k * (h + gap));
  scene += '</div>';
  return `<div class="totem money-tower${short ? ' short' : ''}" role="img" aria-label="${short ? `Faltam ${brl(-leftover)}` : `Sobram ${brl(leftover)}`}">
    <div class="stage"><span class="badges"><span class="pill ${short ? 'magenta' : 'cyan'}">${short ? 'Falta' : 'Sobra'}</span></span>${scene}</div>
    <div class="cap"><div class="name">${short ? 'Falta para as essenciais' : 'Dinheiro que sobra'}</div>
      <div class="val num">${brl(Math.abs(leftover))}</div>
      <div class="inst">${short ? `até o fim de ${monthShort(until)}` : `no fim de ${monthShort(until)}${reserve > 0 ? ` · ${brlShort(Math.min(reserve, leftover))} de reserva` : ''}`}</div></div>
  </div>`;
}

const actAttrs = (item) => (item.group ? `data-act="card-group" data-account="${esc(item.accountId)}"` : `data-act="obligation-open" data-id="${esc(item.id)}"`);

export function renderTotem(item, { maxValue, order, isTarget, rate, sim = null }) {
  if (sim) {
    const status = sim.later
      ? `<div class="sim-txt">conta essencial · vence ${sim.dueDate ? `${sim.dueDate.slice(8, 10)}/${sim.dueDate.slice(5, 7)}` : 'depois'}, fora deste período</div>`
      : sim.essential
        ? (sim.done ? `<div class="sim-txt ok">✓ essencial paga com o previsto</div>` : `<div class="sim-txt miss">essencial · falta ${brlShort(sim.left)}</div>`)
        : sim.done
      ? `<div class="sim-txt ok">✓ quitada em ${monthShort(sim.doneAt)}</div>`
      : sim.paid > 0.004
        ? `<div class="sim-txt part">${brlShort(sim.paid)} pagos até ${monthShort(sim.until)}</div><div class="sim-txt miss">falta ${brlShort(sim.left)}</div>`
        : `<div class="sim-txt miss">falta ${brlShort(sim.left)} · o previsto não alcança</div>`;
    return `<button type="button" class="totem sim${sim.done ? ' done' : ''}" ${actAttrs(item)}
        aria-label="${esc(item.ob.beneficiary)}: ${sim.done ? `quitada em ${monthShort(sim.doneAt)}` : `faltam ${brl(sim.left)}`}">
      <div class="stage"><span class="order">#${order}</span>${simSceneHTML(item, sim, maxValue)}</div>
      <div class="cap"><div class="name">${esc(item.ob.beneficiary)}</div><div class="val num">${brlShort(item.updated)}</div>${status}</div>
    </button>`;
  }

  const segmented = item.installment?.total >= 2;
  const h = totemHeights(item.principalPart, item.riskLayer, maxValue);
  const seg = item.group ? groupSceneHTML(item, maxValue) : segmented ? segmentedSceneHTML(item, maxValue) : null;
  const groupLines = item.group ? `<div class="inst">${item.group.map((m) => (m.ob.installmentAmount ? `${esc(m.ob.beneficiary.replace(/ · .*$/, ''))} ${m.installment ? `${m.installment.left ?? ''}x ${brlShort(m.installment.amount)}` : ''}` : `fatura ${brlShort(m.updated)}`)).join(' + ')}</div>` : '';
  const bleedTxt = item.bleed > 0 && rate > 0 ? `sangra ${lifeTime(item.bleed / rate * 60)}/mês` : item.riskParts.protestRisk ? 'risco de cartório' : '';
  const late = item.late > 0;
  const status = late
    ? `<span class="pill magenta">${icon('alert')}Atrasada</span>`
    : item.dueSoon ? `<span class="pill amber">${icon('clock')}${item.daysToDue === 0 ? 'Vence hoje' : item.daysToDue === 1 ? 'Vence amanhã' : `Vence em ${item.daysToDue}d`}</span>` : '';
  return `<button type="button" class="totem${isTarget ? ' target' : ''}${late ? ' late' : ''}" ${actAttrs(item)}
      aria-label="${esc(item.ob.beneficiary)}: ${brl(item.updated)}${late ? `, atrasada há ${item.late} dias` : ''}">
    <div class="stage" data-totem="${esc(item.id)}" data-hb="${h.hb}" data-ht="${h.ht}"${seg ? ` data-paid="${seg.paidBlocks}"` : ''}>
      <span class="order">#${order}</span>
      <span class="badges">${item.quickWin ? '<span class="pill cyan">Vitória rápida</span>' : ''}${status}</span>
      ${seg ? seg.html : totemSceneHTML(h)}
    </div>
    <div class="cap">
      <div class="name">${esc(item.ob.beneficiary)}</div>
      <div class="val num">${brlShort(item.updated)}</div>
      ${late ? `<div class="late-txt">venceu ${dateShort(item.ob.dueDate)} · há ${item.late} dia${item.late > 1 ? 's' : ''}</div>` : ''}
      ${groupLines}
      ${item.installment ? `<div class="inst">${esc(item.installment.label)} · ${brlShort(item.installment.amount)}</div>${installmentBar(item.installment)}` : ''}
      ${bleedTxt ? `<div class="bleed">${bleedTxt}</div>` : ''}
    </div>
  </button>`;
}

/** Anima totens do tamanho anterior para o novo (efeito de encolher após pagamento). */
export function animateTotems(root, prevHeights) {
  const stages = root.querySelectorAll('[data-totem]');
  const next = new Map();
  stages.forEach((st) => {
    const id = st.dataset.totem;
    const target = { hb: Number(st.dataset.hb), ht: Number(st.dataset.ht), paid: st.dataset.paid == null ? null : Number(st.dataset.paid) };
    next.set(id, target);
    const prev = prevHeights?.get(id);
    const scene = st.querySelector('.scene');
    if (target.paid != null) {
      // torre de parcelas: a parcela que acabou de ser paga acende em ciano
      if (prev && prev.paid != null && target.paid > prev.paid) {
        for (let k = prev.paid; k < target.paid; k++) scene.querySelector(`.prism[data-k="${k}"]`)?.classList.add('flash');
        st.closest('.totem')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    if (prev && (prev.hb !== target.hb || prev.ht !== target.ht)) {
      setTotem(scene, prev);
      requestAnimationFrame(() => requestAnimationFrame(() => setTotem(scene, target)));
    }
  });
  return next;
}
