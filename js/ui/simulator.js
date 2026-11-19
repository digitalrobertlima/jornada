// Simulador tátil "Caiu Dinheiro": fatia o valor entre Micro-Escudo e Alvo nº 1
// e mostra, antes de confirmar, o totem encolhendo e as horas de vida subindo.

import { store } from '../store.js';
import { esc, openSheet, toast, haptic, formData } from './dom.js';
import { icon } from './icons.js';
import { brl, lifeTime, parseMoney } from '../core/format.js';
import { round2, num } from '../core/util.js';
import { isRealLiquidity } from '../core/model.js';
import { payObligation, addLedgerEntry } from '../engines/cashflow.js';
import { suggestSplit } from '../engines/eraMachine.js';
import { totemHeights, totemSceneHTML, setTotem } from './deck3d.js';

export function openSimulator(prefill = '') {
  const d = store.derive();
  if (!d) return;
  const target = d.tri.target;
  const accounts = store.state.accounts.filter((a) => a.profileId === store.pid && isRealLiquidity(a));
  const maxValue = target ? target.principalPart + target.riskLayer : 1;
  const h0 = target ? totemHeights(target.principalPart, target.riskLayer, maxValue) : { hb: 0, ht: 0 };

  openSheet({
    title: 'Caiu dinheiro',
    body: `<form novalidate class="stack">
      <label class="field"><span>Quanto caiu?</span>
        <input class="input money" name="value" inputmode="decimal" placeholder="Ex.: 840,00" autocomplete="off" value="${esc(prefill)}"></label>
      ${accounts.length > 1 ? `<label class="field"><span>Caiu em qual conta</span><select class="input" name="accountId">${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>`
    : `<input type="hidden" name="accountId" value="${esc(accounts[0]?.id || '')}">`}

      ${target ? `<div class="sim-stage">
        <div class="totem" style="pointer-events:none"><div class="stage" style="height:180px">${totemSceneHTML(h0)}</div></div>
        <div class="stack" style="gap:8px">
          <span class="eyebrow">${icon('target', 'c-magenta')} Alvo nº 1</span>
          <b>${esc(target.ob.beneficiary)}</b>
          <div class="small">Falta: <b class="num" id="sim-left">${brl(target.dueNow)}</b></div>
          <div class="tiny">${esc(target.reason)}</div>
        </div>
      </div>` : '<div class="alert info">' + icon('info') + '<div>Sem dívidas na mira: tudo vai para o micro-escudo.</div></div>'}

      <div>
        <input class="range" type="range" name="split" min="0" max="100" step="1" value="0" aria-label="Fatia para o Alvo nº 1">
        <div class="row between tiny"><span>${icon('target', 'c-magenta')} Alvo nº 1</span><span class="suggest-mark" id="sim-sug"></span><span>Micro-escudo ${icon('shield', 'c-cyan')}</span></div>
      </div>

      <div class="sim-split">
        <div class="sim-box shield"><span class="tiny">Micro-escudo</span><b class="num" id="sim-shield">R$ 0,00</b><span class="tiny" id="sim-shield-sub"></span></div>
        <div class="sim-box"><span class="tiny">Para o Alvo nº 1</span><b class="num" id="sim-target">R$ 0,00</b><span class="tiny" id="sim-target-sub"></span></div>
      </div>

      <div class="card tight row between">
        <div><span class="eyebrow">Horas de vida</span><div class="sim-life num" id="sim-life">+0min</div></div>
        <div style="text-align:right" class="small" id="sim-water"></div>
      </div>

      <button class="btn primary block" type="submit">${icon('check')}Confirmar e dar baixa</button>
      <p class="tiny" style="text-align:center">Nada é gravado enquanto você mexe. Só no confirmar.</p>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const range = form.split;
      const scene = el.querySelector('.scene');
      let touched = false;

      const compute = () => {
        const value = parseMoney(form.value.value);
        const pct = num(range.value) / 100;
        const need = target ? target.dueNow : 0;
        let toTarget = round2(Math.min(need, value * pct));
        if (need - toTarget > 0 && need - toTarget <= value * 0.01 && value >= need) toTarget = round2(need);
        const toShield = round2(value - toTarget);
        return { value, toTarget, toShield };
      };

      const suggest = () => {
        const value = parseMoney(form.value.value);
        if (!target || value <= 0) return 0;
        return Math.ceil(suggestSplit(value, { target, shieldGap: d.eras.shield.gap, waterlineDeficit: d.eras.waterlineDeficit }) * 100 - 1e-9);
      };

      const update = () => {
        const { value, toTarget, toShield } = compute();
        range.style.setProperty('--v', `${num(range.value)}%`);
        el.querySelector('#sim-shield').textContent = brl(toShield);
        el.querySelector('#sim-target').textContent = brl(toTarget);
        const sug = suggest();
        el.querySelector('#sim-sug').textContent = value > 0 && target ? `sugestão tática: ${sug}% no alvo` : '';

        let minutes = 0;
        let leftAfter = target ? target.dueNow : 0;
        if (target && toTarget > 0) {
          try {
            const sim = payObligation(store.state, { obligationId: target.id, profileId: store.pid, amount: toTarget, date: store.today }, { today: store.today });
            minutes = sim.rescue.minutes;
          } catch { minutes = 0; }
          leftAfter = round2(Math.max(0, target.dueNow - toTarget));
          const ratio = target.dueNow > 0 ? leftAfter / target.dueNow : 0;
          const risk = leftAfter <= 0.01 ? 0 : target.riskLayer * ratio;
          setTotem(scene, totemHeights(target.principalPart * ratio, risk, maxValue));
        } else if (target) {
          setTotem(scene, h0);
        }
        if (target) {
          el.querySelector('#sim-left').textContent = brl(leftAfter);
          el.querySelector('#sim-target-sub').textContent = leftAfter <= 0.01 ? 'alvo abatido ✓' : `faltarão ${brl(leftAfter)}`;
        }
        el.querySelector('#sim-life').textContent = `+${lifeTime(minutes)}`;

        // Linha d'Água depois da operação
        const inWaterline = target && d.wl.items.some((i) => i.id === target.id);
        const floorAfter = d.wl.floor - (inWaterline ? toTarget : 0);
        const cashAfter = d.cash + value - toTarget;
        const gap = round2(floorAfter - cashAfter);
        el.querySelector('#sim-water').innerHTML = gap > 0
          ? `Linha d'Água<br><b class="c-magenta num">faltam ${brl(gap)}</b>`
          : `Linha d'Água<br><b class="c-cyan num">coberta ✓</b>`;
        const shieldNow = Math.max(0, Math.min(d.eras.shield.target, cashAfter - floorAfter));
        el.querySelector('#sim-shield-sub').textContent = `escudo ${brl(shieldNow)} de ${brl(d.eras.shield.target)}`;
      };

      form.value.addEventListener('input', () => {
        if (!touched) range.value = String(suggest());
        update();
      });
      range.addEventListener('input', () => { touched = true; update(); haptic(4); });
      update();
      if (prefill) form.value.dispatchEvent(new Event('input'));

      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const { value, toTarget } = compute();
        if (value <= 0) { toast('Digite quanto caiu.', { tone: 'magenta' }); return; }
        if (!v.accountId) { toast('Cadastre uma conta corrente para receber o valor.', { tone: 'magenta' }); return; }
        const income = addLedgerEntry(store.state, { profileId: store.pid, direction: 'in', amount: value, accountId: v.accountId, category: 'entrada', note: 'Caiu dinheiro' }, { today: store.today });
        await store.commit(income.changes, { render: false });
        let minutes = 0;
        if (target && toTarget > 0) {
          const pay = payObligation(store.state, { obligationId: target.id, profileId: store.pid, amount: toTarget, accountId: v.accountId, date: store.today }, { today: store.today, btcPrice: store.btcPrice() });
          await store.commit(pay.changes, { render: false });
          minutes = pay.rescue.minutes;
        }
        store.onChange();
        close();
        haptic([20, 50, 20]);
        toast(`Entrada de ${brl(value)} fatiada.${minutes > 0 ? ` <b class="c-cyan">+${lifeTime(minutes)}</b> de vida resgatadas.` : ''}`, { tone: 'cyan', iconName: 'bolt', timeout: 5200 });
      };
    },
  });
}
