// Cofre Soberano — placar de Satoshis, trilha rumo a 1.00 BTC, 4 Eras e Trava de Soberania.

import { esc } from '../dom.js';
import { icon } from '../icons.js';
import { brl, int, btc, dateBR, pct } from '../../core/format.js';
import { SATS_MILESTONES, satsProgress } from '../../engines/eraMachine.js';
import { satsToBRL, monthlyYieldProjection } from '../../engines/satsYield.js';

function ago(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return dateBR(iso.slice(0, 10));
}

export function renderSovereign(d, store) {
  const { sats, eras } = d;
  const price = store.btcPrice();
  const cdi = store.cdi();
  const market = store.meta.market || {};
  const manual = store.meta.manual || {};
  const yieldCards = store.state.accounts.filter((a) => a.profileId === d.pid && a.type === 'collateralized_yield_crypto');
  const lock = eras.lock;

  const ticks = SATS_MILESTONES.map((m) => {
    const left = satsProgress(m) * 100;
    const label = m >= 1e8 ? '1 BTC' : m >= 1e6 ? `${m / 1e6}M` : `${m / 1e3}k`;
    return `<div class="tick${sats.total >= m ? ' on' : ''}" style="left:${left}%"><i></i>${label}</div>`;
  }).join('');

  // fase futura nunca aparece como "concluída": ela só conta depois que as anteriores fecham
  const erasHTML = eras.eras.map((e) => `<div class="era${e.done && e.n < eras.currentEra ? ' done' : ''}${e.n === eras.currentEra ? ' current' : ''}${e.n > eras.currentEra ? ' later' : ''}">
      <div class="medal">${e.roman}</div>
      <div>
        <div class="row between"><b>${esc(e.name)}</b><span class="tiny num">${e.n > eras.currentEra ? (e.done ? 'pronta quando chegar' : 'depois') : `${Math.round(e.progress * 100)}%`}</span></div>
        <div class="tiny">${esc(e.goal)}</div>
        ${e.n <= eras.currentEra ? `<ul class="checks">${e.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'clock')}<span>${esc(c.label)}${c.detail ? ` <span class="tiny">· ${esc(c.detail)}</span>` : ''}</span></li>`).join('')}</ul>` : ''}
      </div>
    </div>`).join('');

  const yieldHTML = yieldCards.map((a) => {
    const proj = monthlyYieldProjection(a, { cdiAnnual: cdi, btcPrice: price });
    return `<div class="row between small" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <span><b>${esc(a.name)}</b><br><span class="tiny">${brl(a.collateralTotal)} em garantia · ${a.yieldConfig.cdiPercent}% do CDI + ${pct(a.yieldConfig.cashbackPercent)} cashback</span></span>
      <span style="text-align:right" class="num"><b class="c-cyan">+${int(proj.sats)} sats</b><br><span class="tiny">≈ ${brl(proj.brl)}/mês</span></span>
    </div>`;
  }).join('');

  return `<div class="stack">
    <section class="card sats-hero glow-cyan">
      <span class="eyebrow">${icon('btc', 'c-cyan')} Placar de Satoshis</span>
      <div class="big num" style="margin-top:6px">${int(sats.total)} <span style="font-size:18px">sats</span></div>
      <div class="small num">${btc(sats.total)}${price ? ` · ≈ ${brl(satsToBRL(sats.total, price))}` : ''}</div>
      <div class="btc-track" aria-label="Progresso rumo a 1 BTC">
        <div class="rail"></div><div class="fill" style="width:${satsProgress(sats.total) * 100}%"></div>${ticks}
      </div>
      <div class="grid-2" style="margin-top:6px">
        <div class="liq-chip"><span class="tiny">Rendimento CDI</span><b class="num c-cyan">${int(sats.yieldSats)}</b></div>
        <div class="liq-chip"><span class="tiny">Cashback</span><b class="num c-cyan">${int(sats.cashbackSats)}</b></div>
        <div class="liq-chip" style="grid-column:1/-1"><span class="tiny">Aportes diretos / autocustódia</span><b class="num">${int(sats.direct)}</b></div>
      </div>
      <p class="tiny" style="margin-top:10px">O gotejamento do cartão com garantia entra aqui sem tocar no dinheiro do aluguel: garantia nunca é liquidez.</p>
    </section>

    <section class="card lock-card ${lock.locked ? 'locked' : 'open'}">
      <div class="row">
        <span class="lock-icon">${icon(lock.locked ? 'lock' : 'unlock')}</span>
        <div class="grow"><b>Trava de segurança ${lock.locked ? 'fechada' : 'aberta'}</b>
          <div class="tiny">${lock.locked ? 'Investir em cripto só depois que o essencial e as dívidas urgentes estiverem resolvidos.' : `Excedente real disponível: ${brl(lock.excess)}`}</div></div>
      </div>
      ${lock.locked ? `<ul class="reasons">${lock.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      <div class="row wrap" style="margin-top:12px;gap:8px">
        <button class="btn sm ${lock.locked ? '' : 'primary'}" data-act="aporte" ${lock.locked ? 'disabled' : ''}>${icon('btc')}Registrar aporte</button>
        <button class="btn sm ghost" data-act="sats-update">Atualizar saldo em autocustódia</button>
      </div>
    </section>

    ${yieldCards.length ? `<section class="card"><div class="row between"><h2 style="font-size:15px">Gotejamento mensal</h2><span class="eyebrow">projeção</span></div>${yieldHTML}</section>` : ''}

    <section class="card">
      <div class="row between" style="margin-bottom:12px"><h2 style="font-size:15px">As 4 Eras</h2><span class="eyebrow">Era ${eras.eras[eras.currentEra - 1].roman} em curso</span></div>
      <div class="eras">${erasHTML}</div>
    </section>

    <section class="card tight">
      <div class="row between"><span class="eyebrow">Cotações ao vivo</span>
        <button class="btn sm ghost" data-act="market-refresh">${icon('refresh')}Atualizar</button></div>
      <div class="row between small" style="margin-top:8px"><span>BTC/BRL</span><span class="num"><b>${price ? brl(price, { cents: false }) : '—'}</b>
        <span class="tiny">${manual.btc ? 'manual' : market.btc ? `${esc(market.btc.source)} · ${ago(market.btc.at)}` : 'referência offline'}</span></span></div>
      <div class="row between small" style="margin-top:4px"><span>CDI</span><span class="num"><b>${cdi ? `${cdi.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.a.` : '—'}</b>
        <span class="tiny">${manual.cdi ? 'manual' : market.cdi ? `${esc(market.cdi.source)} · ${ago(market.cdi.at)}` : 'referência offline'}</span></span></div>
      <p class="tiny" style="margin-top:8px">Buscadas direto do seu aparelho em APIs públicas. Nenhum dado seu é enviado.</p>
    </section>
  </div>`;
}
