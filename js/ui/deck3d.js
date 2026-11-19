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
      sub = 'Liquidez real · conta para a Linha d\'Água';
      break;
    case 'benefit_card':
      main = `<div class="val num">${brl(a.balance)}</div>`;
      sub = 'Saldo restrito · não paga boleto nem aluguel';
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
      <span class="btn sm" data-act="entry-new" data-account="${esc(a.id)}" data-dir="out" role="button" tabindex="0">${icon('minus')}Gasto</span>
    </div>
  </div>`;
}

export function renderDeck(accounts) {
  if (!accounts.length) {
    return `<div class="empty">Nenhuma conta ainda. Comece pela sua conta corrente: é ela que conta como dinheiro de verdade.</div>`;
  }
  // a conta corrente (liquidez real) fica por cima, à direita do leque
  const order = [...accounts].sort((a, b) => (a.type === 'checking_cash') - (b.type === 'checking_cash'));
  const n = order.length;
  const spread = n > 1 ? Math.min(7, 22 / (n - 1)) : 0;
  const shift = n > 1 ? Math.min(26, 64 / (n - 1)) : 0;
  const cards = order.map((a, i) => {
    const k = i - (n - 1) / 2;
    const rot = (k * spread).toFixed(2);
    const tx = (k * shift).toFixed(1);
    const ty = (Math.abs(k) * 4).toFixed(1);
    return `<button type="button" class="acard t-${a.type}${a.limitShrinking ? ' shrinking' : ''}" data-card="${esc(a.id)}"
        style="--rot:${rot}deg;--tx:${tx}px;--ty:${ty}px;z-index:${i + 1}" aria-label="${esc(a.name)}">
        <div class="flip">${cardFront(a)}${cardBack(a)}</div></button>`;
  }).join('');
  return `<div class="deck" id="deck">${cards}</div><div class="deck-hint">Toque num cartão para trazer à frente · toque de novo para ver o verso</div>`;
}

export function bindDeck(root) {
  const deck = root.querySelector('#deck');
  if (!deck) return;
  deck.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')) return; // ações do verso
    const card = e.target.closest('.acard');
    if (!card) {
      deck.classList.remove('has-active');
      deck.querySelectorAll('.acard').forEach((c) => c.classList.remove('active', 'flipped'));
      return;
    }
    if (card.classList.contains('active')) {
      card.classList.toggle('flipped');
    } else {
      deck.querySelectorAll('.acard').forEach((c) => c.classList.remove('active', 'flipped'));
      card.classList.add('active');
      deck.classList.add('has-active');
    }
  });
  // leve inclinação com o ponteiro (desktop)
  deck.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const active = deck.querySelector('.acard.active:not(.flipped) .flip');
    if (!active) return;
    const r = active.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    active.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 12}deg)`;
  });
  deck.addEventListener('pointerleave', () => {
    deck.querySelectorAll('.flip').forEach((f) => { f.style.transform = ''; });
  });
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

export function renderTotem(item, { maxValue, order, isTarget, rate }) {
  const segmented = item.installment?.total >= 2;
  const h = totemHeights(item.principalPart, item.riskLayer, maxValue);
  const seg = segmented ? segmentedSceneHTML(item, maxValue) : null;
  const bleedTxt = item.bleed > 0 && rate > 0 ? `sangra ${lifeTime(item.bleed / rate * 60)}/mês` : item.riskParts.protestRisk ? 'risco de cartório' : '';
  const late = item.late > 0;
  const status = late
    ? `<span class="pill magenta">${icon('alert')}Atrasada</span>`
    : item.dueSoon ? `<span class="pill amber">${icon('clock')}${item.daysToDue === 0 ? 'Vence hoje' : item.daysToDue === 1 ? 'Vence amanhã' : `Vence em ${item.daysToDue}d`}</span>` : '';
  return `<button type="button" class="totem${isTarget ? ' target' : ''}${late ? ' late' : ''}" data-act="obligation-open" data-id="${esc(item.id)}"
      aria-label="${esc(item.ob.beneficiary)}: ${brl(item.updated)}${late ? `, atrasada há ${item.late} dias` : ''}">
    <div class="stage" data-totem="${esc(item.id)}" data-hb="${h.hb}" data-ht="${h.ht}"${seg ? ` data-paid="${seg.paidBlocks}"` : ''}>
      <span class="order">#${order}</span>
      <span class="badges">${item.quickWin ? '<span class="pill cyan">Quick Win</span>' : ''}${status}</span>
      ${seg ? seg.html : totemSceneHTML(h)}
    </div>
    <div class="cap">
      <div class="name">${esc(item.ob.beneficiary)}</div>
      <div class="val num">${brlShort(item.updated)}</div>
      ${late ? `<div class="late-txt">venceu ${dateShort(item.ob.dueDate)} · há ${item.late} dia${item.late > 1 ? 's' : ''}</div>` : ''}
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
