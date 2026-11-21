// Previsão de entradas: cadastrar, confirmar "caiu", e o plano de como distribuir.

import { store } from '../store.js';
import { esc, openSheet, confirmSheet, toast, haptic, formData, bindSegments } from './dom.js';
import { icon } from './icons.js';
import { brl, dateHuman, parseMoney } from '../core/format.js';
import { addDays } from '../core/dates.js';
import { isRealLiquidity } from '../core/model.js';
import {
  INCOME_KINDS, LOCKS, addForecast, confirmForecast, pendingForecasts, planDistribution,
} from '../engines/forecast.js';

const money = (v) => String(v ?? '').replace('.', ',');
const seg = (name, options, value) => `
  <input type="hidden" name="${name}" value="${esc(value)}">
  <div class="seg" data-name="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;

export function currentPlan(d = store.derive()) {
  if (!d) return null;
  return planDistribution(store.state, d.pid, d.today, d.tri, { reserveTarget: d.profile?.shieldTarget || 500 });
}

// ------------------------------------------------------------ cadastrar

export function openForecastSheet({ kind = 'salario' } = {}) {
  const pid = store.pid;
  const accounts = store.state.accounts.filter((a) => a.profileId === pid);
  const liquidAccs = accounts.filter(isRealLiquidity);
  const lockedAccs = accounts.filter((a) => a.type === 'benefit_card');
  const accOpts = (list) => list.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  openSheet({
    title: 'Previsão de entrada',
    body: `<form novalidate class="stack">
      <p class="small">Conte o que vai cair e quando. O app calcula como distribuir esse dinheiro entre as suas contas.</p>
      <label class="field"><span>O que vai entrar?</span><select class="input" name="kind">
        ${Object.entries(INCOME_KINDS).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field"><span>Quanto?</span><input class="input money" name="amount" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
      <label class="field"><span>Em que dia deve cair?</span><input class="input" type="date" name="date" value="${addDays(store.today, 5)}" min="${store.today}"></label>

      <div class="card tight stack">
        <b>Esse dinheiro cai como...</b>
        ${seg('liquidity', [['pix', 'Pix / conta (livre)'], ['locked', 'Vale / cartão (travado)']], INCOME_KINDS[kind].liquidity)}
        <p class="tiny" data-liq-hint></p>
        <div data-box="pix"><label class="field"><span>Em qual conta</span>
          ${liquidAccs.length ? `<select class="input" name="accountId">${accOpts(liquidAccs)}</select>` : '<small>Você ainda não tem conta corrente cadastrada: vamos criar uma.</small><input class="input" name="newLiquidName" placeholder="Ex.: Nubank, Caixa" value="Conta principal">'}</label></div>
        <div data-box="locked" hidden>
          ${lockedAccs.length ? `<label class="field"><span>Em qual cartão</span><select class="input" name="lockedAccountId">${accOpts(lockedAccs)}<option value="__new">+ Outro cartão de benefício</option></select></label>` : '<input type="hidden" name="lockedAccountId" value="__new">'}
          <div class="stack" data-newlocked${lockedAccs.length ? ' hidden' : ''}>
            <label class="field"><span>Nome do cartão</span><input class="input" name="lockedName" placeholder="Ex.: Caju, Alelo, VR" autocomplete="off"></label>
            <label class="field"><span>Serve para</span><select class="input" name="lock">${Object.entries(LOCKS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          </div>
        </div>
      </div>
      <label class="check"><input type="checkbox" name="repeat"><span>Repete todo mês<br><small class="tiny">Quando você confirmar que caiu, o do mês seguinte já fica previsto.</small></span></label>
      <button class="btn primary block" type="submit">Salvar previsão</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      const hint = el.querySelector('[data-liq-hint]');
      const sync = () => {
        const v = formData(form);
        const locked = v.liquidity === 'locked';
        el.querySelector('[data-box="pix"]').hidden = locked;
        el.querySelector('[data-box="locked"]').hidden = !locked;
        el.querySelector('[data-newlocked]').hidden = !(locked && v.lockedAccountId === '__new');
        hint.textContent = locked
          ? 'Travado: só serve para o uso do cartão (mercado, refeição, transporte). Não paga aluguel, boleto nem dívida.'
          : 'Livre: cai na conta e pode pagar qualquer coisa, inclusive dívidas.';
      };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'kind') {
          const info = INCOME_KINDS[e.target.value];
          form.liquidity.value = info.liquidity;
          for (const b of form.querySelectorAll('.seg[data-name="liquidity"] button')) b.setAttribute('aria-pressed', String(b.dataset.v === info.liquidity));
          if (info.lock && form.lock) form.lock.value = info.lock;
        }
        sync();
      });
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const amount = parseMoney(v.amount);
        if (amount <= 0) { toast('Informe quanto vai entrar.', { tone: 'magenta' }); return; }
        if (!v.date || v.date < store.today) { toast('Escolha uma data de hoje em diante.', { tone: 'magenta' }); return; }
        const locked = v.liquidity === 'locked';
        const input = { profileId: pid, kind: v.kind, amount, date: v.date, repeat: v.repeat ? 'monthly' : null };
        if (locked) {
          if (v.lockedAccountId && v.lockedAccountId !== '__new') input.accountId = v.lockedAccountId;
          else input.newAccount = { type: 'benefit_card', name: (v.lockedName || '').trim() || 'Vale', balance: 0, lock: v.lock || INCOME_KINDS[v.kind].lock || 'alimentacao' };
        } else if (v.accountId) input.accountId = v.accountId;
        else input.newAccount = { type: 'checking_cash', name: (v.newLiquidName || '').trim() || 'Conta principal', balance: 0 };
        const { changes, entry } = addForecast(store.state, input, { today: store.today });
        const normalized = { ...changes };
        await store.commit(normalized, { label: `Previsão: ${INCOME_KINDS[v.kind].label} (${brl(amount)}) em ${dateHuman(entry.date)}` });
        close();
        haptic();
      };
    },
  });
}

// ------------------------------------------------------------ detalhe / caiu

export function openForecastDetail(id) {
  const e = store.state.ledger.find((x) => x.id === id);
  if (!e) return;
  const acc = store.state.accounts.find((a) => a.id === e.accountId);
  const overdue = e.date < store.today;
  const locked = e.liquidity === 'locked';
  openSheet({
    title: INCOME_KINDS[e.kind]?.label || 'Entrada prevista',
    body: `<form novalidate class="stack">
      <div class="alert ${overdue ? 'warn' : 'info'}">${icon(overdue ? 'alert' : 'info')}<div>${overdue
    ? `Era para ter entrado em <b>${dateHuman(e.date)}</b>. Já caiu?` : `Previsto para <b>${dateHuman(e.date)}</b> · ${locked ? 'fica <b>travado</b> no cartão' : 'cai <b>livre</b> na conta'}${acc ? ` (${esc(acc.name)})` : ''}.`}</div></div>
      <label class="field"><span>Valor</span><input class="input money" name="amount" inputmode="decimal" value="${money(e.amount)}" autocomplete="off"></label>
      <label class="field"><span>Data prevista</span><input class="input" type="date" name="date" value="${e.date}"></label>
      <button class="btn primary block" type="button" data-landed>${icon('check')}Caiu! Já está na conta</button>
      <div class="grid-2"><button class="btn sm" type="button" data-save>Salvar mudança</button>
        <button class="btn sm danger" type="button" data-del>${icon('trash')}Remover</button></div>
      <p class="tiny">${locked ? 'Ao confirmar, o valor soma no saldo travado do cartão.' : 'Ao confirmar, o valor soma no seu dinheiro livre.'} Dá para desfazer depois.</p>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      el.querySelector('[data-landed]').onclick = async () => {
        const amount = parseMoney(form.amount.value);
        if (amount <= 0) { toast('Informe o valor que caiu.', { tone: 'magenta' }); return; }
        const { changes, entry } = confirmForecast(store.state, id, { amount, date: store.today, today: store.today });
        if (!entry) return;
        await store.commit(changes, { label: `Caiu: ${e.note} (${brl(amount)})` });
        close();
        haptic();
      };
      el.querySelector('[data-save]').onclick = async () => {
        const amount = parseMoney(form.amount.value);
        if (amount <= 0 || !form.date.value) { toast('Confira valor e data.', { tone: 'magenta' }); return; }
        await store.commit({ ledger: [{ ...e, amount, date: form.date.value }] }, { label: `Previsão ajustada: ${e.note}` });
        close();
      };
      el.querySelector('[data-del]').onclick = async () => {
        close();
        if (await confirmSheet({ title: 'Remover previsão?', text: `${esc(e.note)} · ${brl(e.amount)}. Nada muda no seu saldo.`, confirmLabel: 'Remover', danger: true })) {
          await store.commit({ removeLedger: [id] }, { label: `Removeu previsão: ${e.note}` });
        }
      };
    },
  });
}

// ------------------------------------------------------------ plano

function lineHTML(l) {
  const tag = l.paidWith === 'vale' ? '<span class="chip lock">vale</span>' : '<span class="chip pix">Pix</span>';
  const what = l.kind === 'antecipar' ? `Adiantar ${esc(l.name)}${l.partial ? ' (uma parte)' : ''}` : `Pagar ${esc(l.name)}${l.partial ? ' (uma parte)' : ''}`;
  const when = l.date ? (l.late > 0 ? ' · <span class="c-magenta">atrasada</span>' : ` · vence ${dateHuman(l.date)}`) : '';
  return `<button type="button" class="plan-line tap" data-act="pay" data-id="${esc(l.id)}">
    <span>${what}<span class="tiny c-ink3">${when}</span></span><span class="num">${brl(l.amount)} ${tag}</span></button>`;
}

export function planHTML(plan) {
  if (!plan.hasForecast) {
    return `<div class="stack"><div class="empty">Você ainda não cadastrou nenhuma entrada prevista.<br>Cadastre salário, adiantamento ou vale para ver como distribuir.</div>
      <button class="btn primary block" data-act="forecast-new">${icon('plus')}Prever uma entrada</button></div>`;
  }
  const head = {
    ok: ['info', 'Dá para pagar tudo que vence no período.'],
    tight: ['warn', 'As contas essenciais fecham, mas alguma dívida não cabe inteira.'],
    short: ['warn', 'Atenção: falta dinheiro para pelo menos uma conta essencial na data.'],
  }[plan.verdict];
  const gaps = plan.gaps.filter((g) => !g.resolvedAt || g.resolvedAt > g.date);
  const gapHTML = gaps.length ? `<section class="card tight stack"><span class="eyebrow">Onde aperta</span>${gaps.map((g) => `
    <div class="gap"><b>${esc(g.name)}</b> ${g.date <= store.today ? 'já venceu' : `vence ${dateHuman(g.date)}`} (${brl(g.amount)}).
      ${g.resolvedAt ? `Só dá para pagar em ${dateHuman(g.resolvedAt)}, quando o dinheiro entra.` : g.until ? `Até ${dateHuman(g.until)} você tem ${brl(g.have)}: faltam <b class="c-magenta">${brl(g.missing)}</b>.` : `Faltam <b class="c-magenta">${brl(g.missing)}</b> com o que está previsto.`}
      <div class="tiny" style="margin-top:4px">Ligue antes do vencimento e peça para mudar a data${g.resolvedAt ? ` para ${dateHuman(g.resolvedAt)}` : ''}.</div>
      <button class="btn sm" type="button" data-act="script" data-id="${esc(g.id)}" style="margin-top:6px">${icon('phone')}Roteiro de ligação</button></div>`).join('')}</section>` : '';

  const moments = plan.moments.map((m, i) => {
    const title = i === 0
      ? `Hoje · você tem ${brl(plan.cashNow)}${m.income ? ` + ${brl(m.income)} ${m.overdue ? 'que já devia ter caído' : `que entra hoje (${esc(m.label)})`}` : ''}`
      : `${dateHuman(m.date)} · ${m.income >= 0 ? 'entra' : 'sai'} ${esc(m.label)} (${brl(Math.abs(m.income))})`;
    const rows = m.lines.map(lineHTML).join('');
    const extra = [
      m.held > 0.004 ? `<div class="plan-note">${icon('shield')}<span>Segure <b>${brl(m.held)}</b>: vão para as contas essenciais que vencem logo depois.</span></div>` : '',
      m.reserve > 0.004 ? `<div class="plan-note">${icon('shield')}<span>Guarde <b>${brl(m.reserve)}</b> como reserva para imprevistos.</span></div>` : '',
      m.holding && m.leftover > 0.004 ? `<div class="plan-note">${icon('info')}<span>Guarde <b>${brl(m.leftover)}</b>: soma com a próxima entrada para pagar o que falta.</span></div>` : '',
      !m.holding && m.leftover - (m.held || 0) > 0.004 ? `<div class="plan-note">${icon('check')}<span>Sobra <b>${brl(m.leftover - (m.held || 0))}</b> livres.</span></div>` : '',
    ].join('');
    const landed = m.entries.length ? `<div class="row wrap" style="gap:6px;margin-top:6px">${m.entries.map((e) => `<button class="btn sm" data-act="${e.sched ? 'entry-open' : 'forecast-open'}" data-id="${esc(e.id)}">${e.sched ? 'Agendado: ' : e.date < store.today ? 'Já caiu? ' : ''}${esc(e.note)}</button>`).join('')}</div>` : '';
    return `<section class="card tight stack"><b class="small">${title}</b>${rows || (extra.trim() ? '' : '<div class="tiny c-ink3">Nenhuma conta vence nesse período.</div>')}${extra}${landed}</section>`;
  }).join('');

  const lockedHTML = plan.locked.length ? `<section class="card tight stack"><span class="eyebrow">Dinheiro travado</span>
    ${plan.locked.map((l) => `<div class="row between small"><span>${esc(l.label)}</span><b class="num">${brl(l.amount)}</b></div>`).join('')}
    <p class="tiny">Esse valor só vale no cartão. Gaste no mercado e no transporte: assim o seu Pix livre fica todo para contas e dívidas.</p></section>` : '';

  return `<div class="stack">
    <div class="alert ${head[0]}">${icon(head[0] === 'info' ? 'check' : 'alert')}<div><b>${head[1]}</b><br><span class="tiny">Entram ${brl(plan.incomeLiquid)} livres${plan.incomeLocked ? ` e ${brl(plan.incomeLocked)} travados` : ''} até ${dateHuman(plan.horizonEnd)}.</span></div></div>
    ${gapHTML}${moments}${lockedHTML}
    <button class="btn block" data-act="forecast-new">${icon('plus')}Prever outra entrada</button>
    <p class="tiny" style="text-align:center">Plano é uma sugestão: nada é pago sozinho. Toque numa conta para registrar o pagamento.</p>
  </div>`;
}

export function openPlanSheet() {
  const plan = currentPlan();
  if (!plan) return;
  openSheet({ title: 'Como distribuir o que vai entrar', body: planHTML(plan) });
}

// ------------------------------------------------------------ cartão da Carteira

export function forecastCardHTML(d) {
  const list = pendingForecasts(store.state, d.pid);
  const plan = currentPlan(d);
  const rows = list.slice(0, 4).map((e) => {
    const overdue = e.date < store.today;
    const [, m, day] = e.date.split('-');
    return `<button type="button" class="tx tap" data-act="forecast-open" data-id="${esc(e.id)}">
      <div class="day"><b>${day}</b>${m}</div>
      <div class="what"><div>${esc(e.note)}</div><div class="tiny">${e.liquidity === 'locked' ? '<span class="chip lock">travado</span>' : '<span class="chip pix">Pix · livre</span>'}${overdue ? ' · <span class="c-amber">era para cair — caiu?</span>' : ''}${e.repeat ? ' · todo mês' : ''}</div></div>
      <div class="val in num">+${brl(e.amount)}<br><span class="tiny c-ink3">›</span></div></button>`;
  }).join('');
  return `<section class="card">
    <div class="row between"><h2 style="font-size:15px">Previsão de entradas</h2><button class="btn sm ghost" data-act="forecast-new">${icon('plus')}Prever</button></div>
    <div class="ledger-list">${rows || '<div class="empty">Cadastre o salário, o adiantamento e os vales que vão cair. O app mostra como distribuir.</div>'}</div>
    ${list.length ? `<button class="btn block" style="margin-top:10px" data-act="forecast-plan">${icon('spark')}Como distribuir${plan?.gaps.length ? ' · tem conta apertada' : ''}</button>` : ''}
  </section>`;
}
