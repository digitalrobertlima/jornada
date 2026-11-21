// Campo de Batalha — cadastro rápido, Linha de Frente, totens da Bola de Neve e o Domo de Quarentena.

import { round2 } from '../../core/util.js';
import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { brl, brlShort, dateShort } from '../../core/format.js';
import { renderTotem, animateTotems, towerValue, moneyTowerHTML, monthShort } from '../deck3d.js';
import { projectFreedom, atHorizon } from '../../engines/freedom.js';
import { groupCards } from '../../engines/cardGroups.js';
import { deadlineOf, countdownText } from './hud.js';

const ADD = [
  ['boleto', 'boleto', '+ Boleto (colar código)'],
  ['card', 'card', '+ Cartão'],
  ['person', 'person', '+ Pix / Pessoa'],
  ['financing', 'bank', '+ Empréstimo / Financiamento'],
  ['vital', 'home', '+ Vital / Casa'],
];

/** Opções de período da simulação (meses contados a partir deste). */
function horizons(today) {
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const m = Number(today.slice(5, 7)) - 1;
  return [[1, `Até fim de ${MONTHS[m]}`], [2, `Até fim de ${MONTHS[(m + 1) % 12]}`], [3, '3 meses'], [6, '6 meses'], [0, 'Até quitar tudo']];
}

export function renderBattle(d, state = null, sim = null) {
  const { tri, rate, eras } = d;
  let simData = null;
  if (sim?.on && state) {
    const proj = projectFreedom(state, d.pid, d.today, tri, { reserveTarget: d.profile?.shieldTarget || 500 });
    // "até quitar" = até a última torre desta tela cair (as dívidas guardadas ficam fora daqui)
    const h = sim.h || (proj.months !== null ? proj.months + 1 : proj.monthEnd.length);
    const at = atHorizon(proj, h);
    simData = { proj, at, h };
  }
  const towers = groupCards(tri.battlefield, state?.accounts?.filter((a) => a.profileId === d.pid) || []);
  const maxValue = Math.max(1, ...towers.map((i) => towerValue(i) + i.riskLayer));
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

  const simFor = (i) => {
    if (!simData) return null;
    if (i.group) {
      const xs = i.group.map((m) => simData.at.per.get(m.id) || { paid: 0, left: m.updated, done: false });
      const done = xs.every((x) => x.done);
      return { paid: round2(xs.reduce((t, x) => t + x.paid, 0)), left: round2(xs.reduce((t, x) => t + x.left, 0)), done, doneAt: done ? xs.map((x) => x.doneAt).filter(Boolean).sort().pop() : null, until: simData.at.endDate };
    }
    const x = simData.at.per.get(i.id) || { paid: 0, left: i.updated, done: false };
    if (x.essential && !x.dueIn) return { ...x, until: simData.at.endDate, later: true, left: 0 };
    return { ...x, until: simData.at.endDate };
  };
  const totems = towers.map((i, k) => renderTotem(i, { maxValue, order: k + 1, isTarget: tri.target?.id === i.id, rate, sim: simFor(i) })).join('')
    + (simData && Math.abs(simData.at.leftover) >= 1 ? moneyTowerHTML({ leftover: simData.at.leftover, reserve: simData.at.reserve, maxValue, until: simData.at.endDate }) : '');
  const simBar = tri.battlefield.length ? `<div class="sim-bar">
      <button type="button" class="btn sm${sim?.on ? ' primary' : ''}" data-act="sim-toggle" aria-pressed="${Boolean(sim?.on)}">${icon('spark')}${sim?.on ? 'Simulação ligada · toque para desligar' : 'Simular com o que vai entrar'}</button>
      ${sim?.on ? `<div class="row wrap" style="gap:6px;margin-top:8px">${horizons(d.today).map(([h, l]) => `<button type="button" class="chip-btn${(sim.h || 0) === h ? ' on' : ''}" data-act="sim-h" data-h="${h}">${l}</button>`).join('')}</div>` : ''}
    </div>` : '';
  const simSummary = simData ? (() => {
    const { at, proj } = simData;
    const queue = tri.battlefield.length;
    const doneN = tri.battlefield.filter((i) => at.per.get(i.id)?.done).length;
    const debtsTower = tri.battlefield.filter((i) => !i.isVital);
    const doneD = debtsTower.filter((i) => at.per.get(i.id)?.done).length;
    const essTxt = at.essentialList.map((e) => `${esc(e.name)} ${brlShort(e.amount)} (dia ${e.dueDate.slice(8, 10)}/${e.dueDate.slice(5, 7)})`).join(' + ');
    const free = round2(d.cash + at.income - at.essentials);
    const line = (label, value, cls = '') => `<div class="row between sim-line ${cls}"><span>${label}</span><b class="num">${value}</b></div>`;
    const verdict = free < -0.004
      ? `<span class="c-magenta">Não fecha: faltam ${brl(-free)} só para as contas essenciais. Nada vai para as dívidas nesse período.</span>`
      : at.toDebts > 0.004
        ? `Os ${brl(at.toDebts)} vão para as dívidas na ordem da fila: ${doneD} de ${debtsTower.length} torres caem${at.missing > 0.004 ? ` e ainda ficam ${brl(at.missing)} em dívidas` : ''}.${at.reserve > 0.004 ? ` ${brl(at.reserve)} ficam de reserva.` : ''}`
        : free > 0.004 ? `Sobram ${brl(free)} — ficam de reserva antes de atacar as dívidas.` : 'Fica zerado: nada sobra para as dívidas.';
    return `<div class="card tight sim-summary">
      <b class="small">A conta até o fim de ${monthShort(at.endDate)}</b>
      ${line('Você tem hoje (Pix)', brl(d.cash))}
      ${line('+ Vai entrar (livre)', brl(at.income))}
      ${line('− Contas essenciais', brl(at.essentials))}
      ${essTxt ? `<div class="tiny c-ink3" style="margin:-2px 0 4px">${essTxt}</div>` : ''}
      ${line('= Sobra depois das essenciais', brl(Math.max(0, free)), `total ${free < -0.004 ? 'neg' : ''}`)}
      <div class="small" style="margin-top:8px">${verdict}</div>
      <div class="sim-legend"><span><i class="lg paid"></i>já pago</span><span><i class="lg plan"></i>o previsto paga</span><span><i class="lg ghost"></i>ainda falta</span><span><i class="lg money"></i>sobra</span></div>
      <div class="tiny" style="margin-top:6px">Estimativa: ${proj.assumptions.join('; ')}. O vale travado não entra aqui (só paga mercado/transporte). Nada é pago sozinho.</div>
    </div>`;
  })() : '';

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
        ${simBar}${simSummary}
        <div class="totem-field${simData ? ' sim-on' : ''}">${totems}</div>
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
