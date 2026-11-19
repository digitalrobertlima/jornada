// Detalhes abertos ao tocar nos números da tela inicial e no fluxo diário.
// Regra: todo número é tocável e leva ao que está por trás dele; tudo tem "desfazer".

import { openForecastDetail } from './forecast.js';
import { store } from '../store.js';
import { esc, openSheet, toast } from './dom.js';
import { icon } from './icons.js';
import { brl, lifeTime, dateHuman, dateBR } from '../core/format.js';
import { missionCard } from './views/hud.js';
import { minutesToWorkdays } from '../engines/lifeHours.js';
import { describeAction } from '../engines/journal.js';
import { removeEntry } from './wizards.js';

export function openEssentials() {
  const d = store.derive();
  const deficit = Math.max(0, d.wl.floor - d.cash);
  openSheet({
    title: 'Contas essenciais · 15 dias',
    body: `<div class="stack">
      <p class="small">Casa, comida, transporte, trabalho e boletos que podem ir a cartório até ${esc(dateHuman(d.wl.end))}.
        ${deficit > 0 ? `<b class="c-magenta">Faltam ${brl(deficit)}</b> na conta para cobrir tudo.` : '<b class="c-cyan">Seu dinheiro cobre todas.</b>'}</p>
      ${d.wl.items.length ? d.wl.items.map((i) => missionCard(i, { rate: d.rate })).join('') : '<div class="empty">Nenhuma conta essencial nos próximos 15 dias.</div>'}
      <button class="btn block" type="button" data-act="obligation-new" data-kind="vital">${icon('plus')}Cadastrar conta essencial</button>
    </div>`,
  });
}

export function openVictories() {
  const d = store.derive();
  const p = d.profile;
  const closed = store.state.obligations.filter((o) => o.status === 'paid' && o.type !== 'vital_fixed' && o.profileId === d.pid)
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  const log = p.rescueLog || [];
  openSheet({
    title: 'Suas vitórias',
    body: `<div class="stack">
      <div class="grid-2">
        <div class="liq-chip real"><span class="tiny">Horas de vida resgatadas</span><b class="num">${lifeTime(p.rescuedLifeMinutes)}</b>
          <span class="tiny">≈ ${minutesToWorkdays(p.rescuedLifeMinutes, p).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias de trabalho</span></div>
        <div class="liq-chip real"><span class="tiny">Dívidas quitadas</span><b class="num">${closed.length}</b><span class="tiny">cada uma conta muito</span></div>
      </div>
      <p class="tiny">Hora de vida = o que você ganha por hora contando trabalho e deslocamento (${brl(d.rate)}). Multa, juro ou taxa de cartório que você evitou vira tempo da sua vida de volta.</p>
      ${closed.length ? `<section class="card tight"><span class="eyebrow">Quitadas</span>${closed.map((o) => `<div class="row between small" style="padding:6px 0;border-top:1px solid var(--border)">
        <span>${icon('check', 'c-cyan')} ${esc(o.beneficiary)}</span><span class="tiny">${o.paidAt ? dateBR(o.paidAt) : ''}</span></div>`).join('')}</section>` : ''}
      <section class="card tight"><span class="eyebrow">Horas resgatadas</span>
        ${log.length ? log.slice(0, 30).map((r) => `<div class="row between small" style="padding:6px 0;border-top:1px solid var(--border)">
          <span class="grow">${esc(r.label)}<br><span class="tiny">${esc((r.parts || []).map((x) => x.label).join(' · '))}</span></span>
          <span class="num c-cyan" style="text-align:right"><b>+${lifeTime(r.minutes)}</b><br><span class="tiny">${brl(r.amount)}</span></span></div>`).join('')
    : '<div class="tiny" style="margin-top:6px">Pague uma conta antes de vencer, antes do cartório ou com desconto e as horas aparecem aqui.</div>'}
      </section>
    </div>`,
  });
}

export function openEntry(id) {
  const e = store.state.ledger.find((x) => x.id === id);
  if (!e) return;
  if (e.forecast) { openForecastDetail(id); return; }
  const acc = store.state.accounts.find((a) => a.id === e.accountId);
  const action = store.actionForLedger(id);
  const ob = e.obligationId ? store.state.obligations.find((o) => o.id === e.obligationId) : null;
  openSheet({
    title: e.direction === 'in' ? 'Entrada' : 'Saída',
    body: `<div class="stack">
      <div class="mid num ${e.direction === 'in' ? 'c-cyan' : ''}">${e.direction === 'in' ? '+' : '−'}${brl(e.amount)}</div>
      <div class="card tight">
        ${[['Descrição', esc(e.note || e.category)], ['Categoria', esc(e.category)], ['Conta', esc(acc?.name || '—')], ['Data', esc(dateHuman(e.date))],
    ['Situação', e.status === 'scheduled' ? '<span class="c-amber">agendado</span>' : 'feito'],
    ['Mexe no dinheiro de hoje?', e.impactCashToday ? 'sim' : 'não (cartão ou benefício)'],
    ob ? ['Pagou a conta', esc(ob.beneficiary)] : null].filter(Boolean)
    .map(([k, v]) => `<div class="row between small" style="padding:5px 0"><span class="c-ink2">${k}</span><span>${v}</span></div>`).join('')}
      </div>
      ${action ? `<div class="alert info">${icon('info')}<div>Este lançamento faz parte de: <b>${esc(action.label)}</b>. Desfazer volta tudo junto:
        <ul class="reasons">${describeAction(action, store.state).map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div></div>` : ''}
      <button class="btn danger block" type="button" data-undo>${icon('refresh')}Desfazer${action ? ' tudo' : ''}</button>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-undo]').onclick = async () => {
        close();
        if (action) {
          await store.undo(action.id);
          toast('Desfeito. Saldos e dívidas voltaram ao que eram.', { tone: 'cyan' });
        } else {
          await removeEntry(id);
        }
      };
    },
  });
}
