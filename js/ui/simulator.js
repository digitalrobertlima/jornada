// "Entrou dinheiro" — registra a entrada e, SÓ SE a pessoa pedir, usa parte para pagar uma conta.
// Princípios: padrão seguro (nada é pago sem pedido), uma decisão por vez, e antes de confirmar
// a tela diz em palavras simples tudo o que vai acontecer. Tudo pode ser desfeito depois.

import { store } from '../store.js';
import { esc, openSheet, toast, haptic, formData, celebrate } from './dom.js';
import { icon } from './icons.js';
import { brl, lifeTime, parseMoney, dateHuman } from '../core/format.js';
import { round2 } from '../core/util.js';
import { isRealLiquidity } from '../core/model.js';
import { payObligation, addLedgerEntry } from '../engines/cashflow.js';
import { suggestSplit } from '../engines/eraMachine.js';
import { totemHeights, totemSceneHTML, setTotem } from './deck3d.js';

const money = (v) => String(round2(v)).replace('.', ',');

export function openSimulator({ prefill = '', debtId = null } = {}) {
  const d = store.derive();
  if (!d) return;
  const accounts = store.state.accounts.filter((a) => a.profileId === store.pid && isRealLiquidity(a));
  const debts = [...d.tri.frontline, ...d.tri.battlefield];
  const first = debts.find((i) => i.id === debtId) || (d.tri.target && debts.includes(d.tri.target) ? d.tri.target : debts[0]);

  openSheet({
    title: 'Entrou dinheiro',
    body: `<form novalidate class="stack">
      <label class="field"><span>Quanto entrou?</span>
        <input class="input money" name="value" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(prefill)}"></label>
      ${accounts.length > 1 ? `<label class="field"><span>Em qual conta</span><select class="input" name="accountId">${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>`
    : `<input type="hidden" name="accountId" value="${esc(accounts[0]?.id || '')}">`}

      ${debts.length ? `<div class="card tight stack">
        <label class="check"><input type="checkbox" name="usePay"${debtId ? ' checked' : ''}><span><b>Usar parte para pagar uma conta agora</b><br>
          <small class="tiny">Deixe desmarcado se só quer registrar que o dinheiro entrou.</small></span></label>
        <div class="stack" data-pay hidden>
          <label class="field"><span>Qual conta</span><select class="input" name="debtId">
            ${debts.map((i) => `<option value="${esc(i.id)}"${i === first ? ' selected' : ''}>${esc(i.ob.beneficiary)} · ${brl(i.dueNow)}${i.late > 0 ? ' · ATRASADA' : i.ob.dueDate ? ` · vence ${dateHuman(i.ob.dueDate)}` : ''}</option>`).join('')}
          </select></label>
          <div class="sim-stage">
            <div class="totem" style="pointer-events:none"><div class="stage" style="height:170px" data-sim-stage></div></div>
            <div class="stack" style="gap:8px">
              <label class="field"><span>Quanto pagar</span><input class="input" name="payAmount" inputmode="decimal" placeholder="0,00" autocomplete="off"></label>
              <div class="row wrap" style="gap:6px" data-chips></div>
              <div class="small" data-left></div>
            </div>
          </div>
        </div>
      </div>` : ''}

      <div class="card tight" data-summary></div>
      <button class="btn primary block" type="submit" data-submit>Registrar entrada</button>
      <p class="tiny" style="text-align:center">Errou? Dá para desfazer tudo depois, de uma vez.</p>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const payBox = el.querySelector('[data-pay]');
      const stage = el.querySelector('[data-sim-stage]');
      const debtById = new Map(debts.map((i) => [i.id, i]));
      let lastDebt = null;

      const payValue = (debt, value) => (debt ? round2(Math.max(0, Math.min(parseMoney(form.payAmount.value), value, debt.updated))) : 0);
      const current = () => {
        const v = formData(form);
        const value = parseMoney(v.value);
        const use = Boolean(v.usePay) && debts.length > 0;
        const debt = use ? debtById.get(v.debtId) : null;
        return { v, value, use, debt, pay: payValue(debt, value) };
      };

      const renderDebt = (debt, value) => {
        stage.innerHTML = totemSceneHTML(totemHeights(debt.principalPart, debt.riskLayer, debt.principalPart + debt.riskLayer));
        const sug = value > 0 ? round2(value * suggestSplit(value, { target: debt, shieldGap: d.eras.shield.gap, waterlineDeficit: d.eras.waterlineDeficit })) : 0;
        const chips = [[debt.dueNow, debt.installment ? `1 parcela · ${brl(debt.dueNow)}` : `Tudo · ${brl(debt.dueNow)}`]];
        if (sug > 0 && Math.abs(sug - debt.dueNow) > 0.5) chips.push([sug, `Sugestão · ${brl(sug)}`]);
        el.querySelector('[data-chips]').innerHTML = chips.map(([v, l]) => `<button type="button" class="btn sm" data-fill="${v}">${l}</button>`).join('');
      };

      const update = () => {
        const { v, value, use, debt } = current();
        if (payBox) payBox.hidden = !use;
        if (debt && debt !== lastDebt) {
          renderDebt(debt, value);
          if (!form.payAmount.dataset.touched) form.payAmount.value = value > 0 ? money(Math.min(value, debt.dueNow)) : '';
          lastDebt = debt;
        }
        const pay = payValue(debt, value);
        let minutes = 0;
        if (debt) {
          const left = round2(Math.max(0, debt.updated - pay));
          const ratio = debt.updated > 0 ? left / debt.updated : 0;
          setTotem(stage.querySelector('.scene'), totemHeights(debt.principalPart * ratio, left <= 0.01 ? 0 : debt.riskLayer * ratio, debt.principalPart + debt.riskLayer));
          el.querySelector('[data-left]').innerHTML = left <= 0.01 ? '<span class="c-cyan"><b>Quita esta conta ✓</b></span>'
            : debt.installment && pay >= debt.installment.amount - 0.01 ? `<span class="c-cyan"><b>Paga a ${esc(debt.installment.label)} ✓</b></span>` : `Ainda faltará ${brl(left)}`;
          if (pay > 0) {
            try { minutes = payObligation(store.state, { obligationId: debt.id, profileId: store.pid, amount: pay, date: store.today }, { today: store.today }).rescue.minutes; } catch { minutes = 0; }
          }
        }
        const acc = accounts.find((a) => a.id === v.accountId);
        const cashAfter = round2(d.cash + value - pay);
        const inFloor = debt && d.wl.items.some((i) => i.id === debt.id);
        const gap = round2(d.wl.floor - (inFloor ? pay : 0) - cashAfter);
        const items = [];
        if (value > 0) items.push(`${icon('plus', 'c-cyan')}<span>Entrada de <b>${brl(value)}</b> em ${esc(acc?.name || 'sua conta')}</span>`);
        if (pay > 0) items.push(`${icon('check', 'c-cyan')}<span>Pagamento de <b>${brl(pay)}</b> · ${esc(debt.ob.beneficiary)}${minutes > 0 ? ` · <span class="c-cyan">+${lifeTime(minutes)} de vida</span>` : ''}</span>`);
        if (value > 0) items.push(`${icon('drop', gap > 0 ? 'c-magenta' : 'c-cyan')}<span>Fica na conta: <b>${brl(cashAfter)}</b> · contas essenciais dos próximos 15 dias ${gap > 0 ? `<span class="c-magenta">ainda faltam ${brl(gap)}</span>` : '<span class="c-cyan">cobertas ✓</span>'}</span>`);
        el.querySelector('[data-summary]').innerHTML = items.length
          ? `<span class="eyebrow">O que vai acontecer</span><div class="stack" style="gap:6px;margin-top:8px;font-size:13.5px">${items.map((x) => `<div class="row" style="align-items:flex-start">${x}</div>`).join('')}</div>`
          : '<span class="small">Digite quanto entrou.</span>';
        el.querySelector('[data-submit]').textContent = pay > 0 ? `Registrar entrada e pagar ${brl(pay)}` : 'Registrar entrada';
      };

      form.addEventListener('input', (e) => {
        if (e.target.name === 'payAmount') form.payAmount.dataset.touched = '1';
        if (e.target.name === 'value' && form.payAmount && !form.payAmount.dataset.touched && lastDebt) {
          const val = parseMoney(form.value.value);
          form.payAmount.value = val > 0 ? money(Math.min(val, lastDebt.dueNow)) : '';
        }
        update();
      });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'debtId') { delete form.payAmount.dataset.touched; lastDebt = null; }
        update();
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fill]');
        if (!b) return;
        const val = parseMoney(form.value.value);
        form.payAmount.value = money(val > 0 ? Math.min(Number(b.dataset.fill), val) : Number(b.dataset.fill));
        form.payAmount.dataset.touched = '1';
        update();
      });
      update();

      form.onsubmit = async (e) => {
        e.preventDefault();
        const { v, value, debt, pay } = current();
        if (value <= 0) { toast('Digite quanto entrou.', { tone: 'magenta' }); return; }
        if (!v.accountId) { toast('Cadastre uma conta corrente para receber o valor.', { tone: 'magenta' }); return; }
        const income = addLedgerEntry(store.state, { profileId: store.pid, direction: 'in', amount: value, accountId: v.accountId, category: 'entrada', note: 'Entrou dinheiro' }, { today: store.today });
        const act = await store.commit(income.changes, { render: false, label: `Entrou ${brl(value)}${pay > 0 ? ` e pagou ${debt.ob.beneficiary}` : ''}` });
        let rescue = null;
        let full = false;
        if (pay > 0) {
          const r = payObligation(store.state, { obligationId: debt.id, profileId: store.pid, amount: pay, accountId: v.accountId, date: store.today }, { today: store.today, btcPrice: store.btcPrice() });
          await store.commit(r.changes, { render: false, actionId: act.id });
          rescue = r.rescue;
          full = r.fullyPaid;
        }
        store.onChange();
        close();
        haptic([20, 50, 20]);
        if (pay > 0) {
          celebrate({
            title: full ? 'Dívida quitada!' : `${esc(debt.ob.beneficiary)}: pago`,
            big: rescue?.minutes > 0 ? `+${lifeTime(rescue.minutes)}` : brl(pay),
            sub: rescue?.minutes > 0 ? 'de vida resgatadas' : `entrada de ${brl(value)} registrada`,
          });
        }
      };
    },
  });
}
