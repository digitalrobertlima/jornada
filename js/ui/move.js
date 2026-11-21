// "Mover saldo": passa dinheiro entre as próprias contas (Pix ↔ cofrinho ↔ limite do cartão com garantia).

import { store } from '../store.js';
import { esc, openSheet, toast, haptic } from './dom.js';
import { brl, parseMoney } from '../core/format.js';
import { moveMoney, movableFrom, transferAccounts, shownValue, placeName, canSend } from '../engines/transfer.js';

const where = (a) => (a.type === 'collateralized_yield_crypto' ? 'limite livre' : 'saldo');

export function openMoveSheet({ from = null, to = null } = {}) {
  const accounts = transferAccounts(store.state, store.pid);
  if (accounts.length < 2) {
    toast('Para mover saldo você precisa de pelo menos duas contas (ex.: Pix e cofrinho). Cadastre em "+ Conta".', { tone: 'magenta' });
    return;
  }
  const senders = accounts.filter(canSend);
  const fromId = from && senders.some((a) => a.id === from) ? from : senders[0].id;
  const toDefault = to && accounts.some((a) => a.id === to && a.id !== fromId) ? to : accounts.find((a) => a.id !== fromId).id;
  const opt = (a, sel) => `<option value="${esc(a.id)}"${sel ? ' selected' : ''}>${esc(a.name)} · ${brl(shownValue(a))}</option>`;
  openSheet({
    title: 'Mover saldo',
    body: `<form novalidate class="stack">
      <p class="small">Passa o dinheiro de um lugar para outro. Não é gasto nem entrada, e dá para desfazer.</p>
      <label class="field"><span>Sai de</span><select class="input" name="from">${senders.map((a) => opt(a, a.id === fromId)).join('')}</select></label>
      <div class="move-swap"><button class="btn sm" type="button" data-swap aria-label="Inverter origem e destino">⇅ Inverter</button></div>
      <label class="field"><span>Vai para</span><select class="input" name="to">${accounts.map((a) => opt(a, a.id === toDefault)).join('')}</select></label>
      <label class="field"><span>Valor</span>
        <input class="input money" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button class="btn sm" type="button" data-all>Tudo que dá</button>
        <button class="btn sm" type="button" data-half>Metade</button>
      </div>
      <div class="card" id="move-prev" aria-live="polite"></div>
      <button class="btn primary block" type="submit">Mover</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const prev = el.querySelector('#move-prev');
      const get = (id) => store.state.accounts.find((a) => a.id === id);
      const sync = () => {
        const A = get(form.from.value);
        const B = get(form.to.value);
        const v = parseMoney(form.amount.value);
        const max = movableFrom(A);
        if (!A || !B) { prev.innerHTML = ''; return; }
        const same = A.id === B.id;
        let html = `<div class="tiny">Dá para tirar de ${esc(A.name)}: <b class="num">${brl(max)}</b>${A.type === 'collateralized_yield_crypto' && A.lockedInstallments > 0 ? ` <span class="c-ink3">(${brl(A.lockedInstallments)} travado em parcelas)</span>` : ''}</div>`;
        if (same) html += '<div class="tiny c-magenta">Escolha contas diferentes.</div>';
        else if (v > 0) {
          try {
            const r = moveMoney(store.state, { fromId: A.id, toId: B.id, amount: v });
            html += `<div class="row between"><span>${esc(A.name)} <span class="tiny c-ink3">(${where(A)})</span></span><span class="num">${brl(shownValue(A))} → <b>${brl(shownValue(r.from))}</b></span></div>
              <div class="row between"><span>${esc(B.name)} <span class="tiny c-ink3">(${where(B)})</span></span><span class="num">${brl(shownValue(B))} → <b class="c-cyan">${brl(shownValue(r.to))}</b></span></div>`;
            if (A.type === 'checking_cash' && store.derive()?.wl?.floor > 0 && store.derive().cash - v < store.derive().wl.floor) {
              html += `<div class="tiny c-amber">Atenção: depois disso o Pix fica abaixo das contas essenciais dos próximos 15 dias (${brl(store.derive().wl.floor)}).</div>`;
            }
          } catch (err) { html += `<div class="tiny c-magenta">${esc(err.message)}</div>`; }
        }
        prev.innerHTML = html;
      };
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      el.querySelector('[data-swap]').onclick = () => {
        const a = form.from.value; const b = form.to.value;
        if (![...form.from.options].some((o) => o.value === b)) { toast('Essa conta não pode ser a origem (vale é travado).'); return; }
        form.from.value = b; form.to.value = a; sync();
      };
      el.querySelector('[data-all]').onclick = () => { form.amount.value = String(movableFrom(get(form.from.value))).replace('.', ','); sync(); };
      el.querySelector('[data-half]').onclick = () => { form.amount.value = String(Math.floor(movableFrom(get(form.from.value)) * 50) / 100).replace('.', ','); sync(); };
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = moveMoney(store.state, { fromId: form.from.value, toId: form.to.value, amount: parseMoney(form.amount.value) });
          await store.commit(r.changes, { label: `Moveu ${brl(r.amount)}: ${placeName(r.before.from)} → ${placeName(r.before.to)}` });
          close();
          haptic();
        } catch (err) { toast(err.message, { tone: 'magenta' }); }
      };
    },
  });
}
