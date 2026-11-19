// Campo de Batalha — cadastro rápido, Linha de Frente, totens da Bola de Neve e o Domo de Quarentena.

import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { brl, brlShort, dateShort } from '../../core/format.js';
import { renderTotem, animateTotems, towerValue } from '../deck3d.js';
import { deadlineOf, countdownText } from './hud.js';

const ADD = [
  ['boleto', 'boleto', '+ Boleto (colar código)'],
  ['card', 'card', '+ Cartão'],
  ['person', 'person', '+ Pix / Pessoa'],
  ['financing', 'bank', '+ Empréstimo / Financiamento'],
  ['vital', 'home', '+ Vital / Casa'],
];

export function renderBattle(d) {
  const { tri, rate, eras } = d;
  const maxValue = Math.max(1, ...tri.battlefield.map((i) => towerValue(i) + i.riskLayer));
  const shrinking = tri.battlefield.filter((i) => i.alerts.some((a) => a.kind === 'limitShrinking'));
  const bfTotal = tri.battlefield.reduce((s, i) => s + i.updated, 0);
  const bleedTotal = tri.battlefield.reduce((s, i) => s + i.bleed, 0);

  const front = tri.frontline.map((i) => {
    const dl = deadlineOf(i);
    const cd = dl ? countdownText(dl.date) : null;
    return `<button type="button" class="front-row" data-act="obligation-open" data-id="${esc(i.id)}">
      <span class="t">${esc(i.ob.beneficiary)}</span><span class="v num">${brl(i.dueNow)}</span>
      <span class="tiny">${esc(i.reason)}${i.ob.isShared ? ' · sua cota' : ''}${i.installment ? ` · ${esc(i.installment.label)}` : ''}</span>
      <span class="tiny ${cd?.hot ? 'c-magenta' : ''}" style="text-align:right">${cd ? `${dl.kind === 'cartório' ? 'cartório ' : ''}${cd.late ? cd.text : `em ${cd.text}`}` : ''}</span>
    </button>`;
  }).join('');

  const totems = tri.battlefield.map((i, k) => renderTotem(i, { maxValue, order: k + 1, isTarget: tri.target?.id === i.id, rate })).join('');

  const dome = tri.quarantine.map((i) => {
    const offer = i.updated * (1 - (i.ob.settlementDiscountPercent || 80) / 100);
    return `<button type="button" class="front-row" data-act="obligation-open" data-id="${esc(i.id)}">
      <span class="t">${esc(i.ob.beneficiary)}</span><span class="v num">${brlShort(i.updated)}</span>
      <span class="tiny">${esc(i.reason)}</span><span class="tiny c-cyan" style="text-align:right">meta à vista ≈ ${brlShort(offer)}</span>
    </button>`;
  }).join('');

  return `<div class="stack">
    <div class="add-grid">
      ${ADD.map(([kind, ic, label]) => `<button class="btn" data-act="obligation-new" data-kind="${kind}">${icon(ic)}${label}</button>`).join('')}
    </div>

    <section class="card">
      <div class="zone-head"><span class="zone-num z1">1</span><div class="grow"><h2 style="font-size:15px">Urgente</h2>
        <div class="tiny">Contas essenciais (casa, comida, transporte, trabalho) e boletos que podem ir a cartório. Vêm antes de tudo.</div></div></div>
      <div style="margin-top:6px">${front || '<div class="empty">Nada urgente. Cadastre aluguel, luz, água, transporte e boletos com risco de protesto.</div>'}</div>
    </section>

    <section class="card">
      <div class="zone-head"><span class="zone-num z2">2</span><div class="grow"><h2 style="font-size:15px">Dívidas, em ordem de ataque</h2>
        <div class="tiny">Atrasadas no topo (rodam juros), depois o que vence em até 7 dias. O resto segue a data e a Bola de Neve.</div></div></div>
      ${shrinking.map((i) => `<div class="alert" style="margin-top:12px">${icon('alert')}<div><b>${esc(i.ob.beneficiary)}</b> — ${esc(i.alerts.find((a) => a.kind === 'limitShrinking').text)}</div></div>`).join('')}
      ${tri.battlefield.length ? `<div class="row between small" style="margin-top:12px"><span>Total: <b class="num">${brl(bfTotal)}</b></span>
        ${bleedTotal > 0 && rate > 0 ? `<span class="c-magenta">sangria ≈ ${brl(bleedTotal)}/mês</span>` : ''}</div>
        <div class="totem-field">${totems}</div>
        <div class="tiny">Cinza = valor a pagar · cada bloco é uma parcela (ciano = paga) · topo magenta pulsante = juros, multa e risco de cartório. Toque num totem para agir.</div>`
    : '<div class="empty">Campo limpo. Nenhuma dívida ativa com pessoas ou cartões.</div>'}
    </section>

    <details class="card dome"${eras.currentEra >= 3 ? ' open' : ''}>
      <summary>
        <span class="dome-icon">${icon('dome')}</span>
        <span class="grow"><b>Dívidas antigas (guardadas)</b><br><span class="tiny">${tri.quarantine.length
    ? `${tri.quarantine.length} dívida(s) antiga(s) selada(s) até a Era III. Fora do fluxo diário.`
    : 'Vazio. Dívidas antigas estouradas por juros ficam isoladas aqui.'}</span></span>
        ${icon('chev', 'chev')}
      </summary>
      ${tri.quarantine.length ? `<div style="margin-top:10px">
        <p class="small" style="margin-bottom:6px">Estas dívidas não somam no seu placar diário. Na Era III você junta reserva e propõe quitação à vista com 70% a 90% de desconto.</p>
        ${dome}</div>` : ''}
    </details>
  </div>`;
}

export function mountBattle(root, prevHeights) {
  return animateTotems(root, prevHeights);
}

export { dateShort };
