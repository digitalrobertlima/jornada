// Wizards e formulários: onboarding, cadastro rápido (5 botões), pagamento, lançamentos, contas, perfis.

import { store } from '../store.js';
import {
  esc, openSheet, toast, formData, bindSegments, copyText, confirmSheet, haptic, celebrate,
} from './dom.js';
import { icon } from './icons.js';
import { brl, brlShort, lifeTime, parseMoney, dateHuman, dateShort } from '../core/format.js';
import { addDays, addMonths, isISODate } from '../core/dates.js';
import { uid, num, round2 } from '../core/util.js';
import {
  normalizeAccount, normalizeObligation, normalizeProfile, normalizeHousehold, VITAL_KINDS, ACCOUNT_TYPES, isRealLiquidity, installmentInfo,
} from '../core/model.js';
import { installmentBar } from './deck3d.js';
import { parseBoleto } from '../parsers/boletoParser.js';
import { payObligation, addLedgerEntry, removeLedgerEntry, invoiceDue } from '../engines/cashflow.js';
import { buildItem, memberIds } from '../engines/triage.js';
import { negotiationScript } from '../engines/scripts.js';
import { describeAction } from '../engines/journal.js';
import { cloudConfigured, connectGoogle } from './cloud.js';
import { customCategories } from '../recipes/model.js';
import { moneyToMinutes, realHourlyRate } from '../engines/lifeHours.js';
import { brlToSats } from '../engines/satsYield.js';
import { buildDemoScenario } from '../db/demoScenario.js';

// ------------------------------------------------------------ helpers de formulário

const moneyField = (name, label, value = '', { hint = '', big = false, required = false } = {}) => `
  <label class="field"><span>${label}</span>
    <input class="input${big ? ' money' : ''}" name="${name}" inputmode="decimal" autocomplete="off" placeholder="0,00"
      value="${value === '' || value == null ? '' : String(value).replace('.', ',')}"${required ? ' required' : ''}>
    ${hint ? `<small>${hint}</small>` : ''}</label>`;

const textField = (name, label, value = '', { placeholder = '', required = false, hint = '' } = {}) => `
  <label class="field"><span>${label}</span>
    <input class="input" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"${required ? ' required' : ''} maxlength="60">
    ${hint ? `<small>${hint}</small>` : ''}</label>`;

const numField = (name, label, value = '', { step = 'any', hint = '', placeholder = '' } = {}) => `
  <label class="field"><span>${label}</span>
    <input class="input" name="${name}" type="number" inputmode="decimal" step="${step}" value="${value ?? ''}" placeholder="${placeholder}">
    ${hint ? `<small>${hint}</small>` : ''}</label>`;

const dateField = (name, label, value = '', { hint = '', required = false } = {}) => `
  <label class="field"><span>${label}</span>
    <input class="input" type="date" name="${name}" value="${value || ''}"${required ? ' required' : ''}>
    ${hint ? `<small>${hint}</small>` : ''}</label>`;

const checkField = (name, label, checked = false, hint = '') => `
  <label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}><span>${label}${hint ? `<br><small class="tiny">${hint}</small>` : ''}</span></label>`;

const seg = (name, options, value, cls = '') => `
  <input type="hidden" name="${name}" value="${esc(value)}">
  <div class="seg ${cls}" data-name="${name}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;

function accountSelect(name, accounts, selected, { includeOutside = false, label = 'Conta' } = {}) {
  const opts = accounts.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)} · ${esc(ACCOUNT_TYPES[a.type]?.short || '')}</option>`).join('');
  return `<label class="field"><span>${label}</span><select class="input" name="${name}">
    ${opts}${includeOutside ? `<option value=""${!selected ? ' selected' : ''}>Pago por fora (não mexe nos saldos)</option>` : ''}</select></label>`;
}

function itemFor(id) {
  const d = store.derive();
  const all = [...d.tri.frontline, ...d.tri.battlefield, ...d.tri.quarantine];
  let item = all.find((i) => i.id === id);
  if (!item) {
    const ob = store.state.obligations.find((o) => o.id === id);
    if (!ob) return null;
    item = buildItem(ob, store.pid, { today: store.today, members: memberIds(store.state), accountsById: new Map(store.state.accounts.map((a) => [a.id, a])) });
  }
  return item;
}

function ensureHousehold(changes) {
  if (!store.state.household?.id) changes.household = [normalizeHousehold({ name: 'Minha Casa' })];
}

// ------------------------------------------------------------ Parcelamento (qualquer dívida)

function installmentBlock(ex, { forced = false, withDate = true, amountName = 'amount' } = {}) {
  const on = forced || Boolean(ex?.installmentAmount);
  const total = ex?.installmentsTotal ?? '';
  const paidN = ex?.installmentsTotal != null && ex?.installmentsLeft != null ? ex.installmentsTotal - ex.installmentsLeft : 0;
  return `<div class="card tight stack" data-inst data-amount-name="${amountName}">
    ${forced ? '<input type="hidden" name="isInstallment" value="1"><span class="eyebrow">Parcelas</span>'
    : checkField('isInstallment', 'É parcelado', on, 'Ex.: 3x de R$ 75. O app cobra uma parcela por vez e avança sozinho para a próxima.')}
    <div class="stack" data-inst-fields${on ? '' : ' hidden'}>
      <div class="grid-2">
        ${numField('installmentsTotal', 'Total de parcelas', total, { step: 1, placeholder: 'Ex.: 3' })}
        ${numField('installmentsPaid', 'Já paguei', paidN, { step: 1 })}
      </div>
      <div class="grid-2">
        ${moneyField('installmentAmount', 'Valor de cada parcela', ex?.installmentAmount ?? '')}
        ${withDate ? dateField('nextDue', 'Próxima parcela vence', ex?.dueDate || '') : ''}
      </div>
      <div class="tiny" data-inst-hint></div>
    </div>
  </div>`;
}

function bindInstallments(form) {
  const box = form.querySelector('[data-inst]');
  if (!box) return;
  const fields = box.querySelector('[data-inst-fields]');
  const hint = box.querySelector('[data-inst-hint]');
  const amountEl = form.elements[box.dataset.amountName];
  const chk = form.querySelector('input[type=checkbox][name=isInstallment]');
  const isOn = () => (chk ? chk.checked : true);
  // valor digitado pela pessoa nunca é sobrescrito; valor preenchido pelo app pode ser recalculado
  amountEl?.addEventListener('input', () => { delete amountEl.dataset.auto; });
  const sync = () => {
    const on = isOn();
    fields.hidden = !on;
    form.querySelectorAll('[data-single-due]').forEach((el) => { el.hidden = on; });
    if (!on) { hint.textContent = ''; return; }
    const total = Math.round(num(form.installmentsTotal.value));
    const left = total - Math.round(num(form.installmentsPaid.value));
    const parcela = parseMoney(form.installmentAmount.value);
    if (total > 0 && left <= 0) {
      hint.innerHTML = '<span class="c-magenta">Se já pagou todas, a dívida está quitada.</span>';
      return;
    }
    if (left > 0 && parcela > 0) {
      const rest = round2(parcela * left);
      if (amountEl && (!amountEl.value || amountEl.dataset.auto)) {
        amountEl.value = String(rest).replace('.', ',');
        amountEl.dataset.auto = '1';
      }
      const typed = parseMoney(amountEl?.value);
      hint.innerHTML = `Faltam <b>${left}x de ${brl(parcela)}</b> = ${brl(rest)}${typed && Math.abs(typed - rest) > 0.5 ? ` · saldo informado: ${brl(typed)}` : ''}`;
    } else if (left > 0 && parseMoney(amountEl?.value) > 0) {
      hint.innerHTML = `Faltam <b>${left}x de ${brl(parseMoney(amountEl.value) / left)}</b> (dividindo o total). Ajuste o valor da parcela se for diferente.`;
    } else {
      hint.textContent = 'Informe o total de parcelas e o valor de cada uma.';
    }
  };
  chk?.addEventListener('change', () => {
    // boleto/carnê: o valor lido do código é o de UMA parcela
    if (chk.checked && !form.installmentAmount.value && amountEl?.value && form.querySelector('[name=barcode]')) {
      form.installmentAmount.value = amountEl.value;
      amountEl.dataset.auto = '1';
    }
    sync();
  });
  box.addEventListener('input', sync);
  sync();
}

function readInstallments(v, amount) {
  const on = v.isInstallment === true || v.isInstallment === '1';
  if (!on) return { fields: { installmentAmount: null, installmentsLeft: null, installmentsTotal: null }, amount, nextDue: null };
  const total = Math.round(num(v.installmentsTotal));
  const left = total - Math.max(0, Math.round(num(v.installmentsPaid)));
  if (total < 1) throw new Error('Informe em quantas parcelas foi dividido.');
  if (left < 1) throw new Error('Se todas as parcelas já foram pagas, a dívida está quitada.');
  let parcela = parseMoney(v.installmentAmount);
  let amt = amount;
  if (parcela <= 0 && amt > 0) parcela = round2(amt / left);
  if (parcela <= 0) throw new Error('Informe o valor de cada parcela.');
  if (amt <= 0) amt = round2(parcela * left);
  return { fields: { installmentAmount: parcela, installmentsTotal: total, installmentsLeft: left }, amount: amt, nextDue: v.nextDue || null };
}

// ------------------------------------------------------------ Onboarding

export function renderOnboarding(root, { onDone }) {
  document.body.classList.add('hide-nav');
  root.innerHTML = `<div class="onboard">
    <span class="eyebrow">${icon('shield', 'c-cyan')} Resgate financeiro · 100% no seu aparelho</span>
    <h1>Sair da dívida começa por <em>saber o que atacar primeiro.</em></h1>
    <div class="promise">
      <div>${icon('target')}<span>Triagem automática: o que é vital, o que pode ir a cartório e o que pode esperar.</span></div>
      <div>${icon('hourglass')}<span>Cada juro evitado vira horas da sua vida de volta.</span></div>
      <div>${icon('lock')}<span>Sem cadastro, sem servidor. Seus dados ficam só neste aparelho.</span></div>
    </div>
    <button class="btn primary block" data-ob="zero">${icon('plus')}Começar do zero</button>
    ${cloudConfigured() ? `<button class="btn block" data-ob="google">${icon('cloud')}Já uso o Jornada: entrar com Google</button>` : ''}
    <button class="btn block" data-ob="demo">${icon('spark')}Carregar Cenário Realista de Teste</button>
    <p class="tiny" style="text-align:center">O cenário de teste usa dados fictícios e pode ser apagado com um toque.</p>
  </div>`;

  root.querySelector('[data-ob="google"]')?.addEventListener('click', async () => {
    try {
      const d = await connectGoogle();
      if (d === 'none' && !store.state.profiles.length) toast('Ainda não há dados salvos nessa conta. Comece do zero e eles serão salvos lá.', { timeout: 6000 });
      onDone();
    } catch (err) { toast(esc(err.message), { tone: 'magenta' }); }
  });

  root.querySelector('[data-ob="demo"]').onclick = async () => {
    const state = buildDemoScenario(store.today);
    await store.replaceAll(state, { activeProfileId: 'prof_01', demo: true });
    toast('Cenário de teste carregado. Explore à vontade.', { tone: 'cyan', iconName: 'spark' });
    onDone();
  };

  root.querySelector('[data-ob="zero"]').onclick = () => {
    root.innerHTML = `<div class="onboard">
      <span class="eyebrow">Calibragem · 1 minuto</span>
      <h1>Quanto vale <em>1 hora da sua vida?</em></h1>
      <p class="small">Usamos sua renda e suas horas (trabalho + deslocamento) para converter juros e multas em tempo de vida.</p>
      <form class="stack" id="ob-form" novalidate>
        ${textField('name', 'Seu nome ou apelido', '', { required: true, placeholder: 'Ex.: Rafa' })}
        ${moneyField('income', 'Renda líquida por mês', '', { big: true, required: true, hint: 'O que cai na conta depois dos descontos.' })}
        <div class="grid-2">
          ${numField('work', 'Horas de trabalho/mês', 176, { hint: '8h × 22 dias = 176' })}
          ${numField('commute', 'Horas de deslocamento/mês', 44, { hint: '2h × 22 dias = 44' })}
        </div>
        ${moneyField('cash', 'Quanto tem hoje na conta corrente?', '', { hint: 'Só dinheiro de verdade. Limite de cartão não conta.' })}
        <label class="field"><span>Micro-escudo de liquidez (meta da Era I)</span>
          ${seg('shield', [['500', 'R$ 500'], ['750', 'R$ 750'], ['1000', 'R$ 1.000']], '500')}</label>
        <div class="tiny" id="ob-rate"></div>
        <button class="btn primary block" type="submit">Entrar na Jornada</button>
      </form>
    </div>`;
    const form = root.querySelector('#ob-form');
    bindSegments(form);
    const preview = () => {
      const v = formData(form);
      const hours = num(v.work) + num(v.commute);
      const income = parseMoney(v.income);
      root.querySelector('#ob-rate').innerHTML = income > 0 && hours > 0
        ? `Sua hora de vida real vale <b class="c-cyan">${brl(income / hours)}</b>. Uma multa de R$ 200 custa ${lifeTime(200 / (income / hours) * 60)} da sua vida.` : '';
    };
    form.addEventListener('input', preview);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = formData(form);
      if (!v.name.trim() || parseMoney(v.income) <= 0) {
        toast('Preencha nome e renda para calibrar as horas de vida.', { tone: 'magenta' });
        return;
      }
      const pid = uid('prof');
      const changes = { profiles: [], accounts: [] };
      ensureHousehold(changes);
      changes.profiles.push(normalizeProfile({
        id: pid, name: v.name.trim(), monthlyNetIncome: parseMoney(v.income), monthlyWorkHours: num(v.work), monthlyCommuteHours: num(v.commute),
        shieldTarget: num(v.shield, 500), hue: 190, createdAt: new Date().toISOString(),
      }));
      changes.accounts.push(normalizeAccount({ id: uid('acc'), profileId: pid, name: 'Conta Corrente', type: 'checking_cash', balance: parseMoney(v.cash) }));
      await store.commit(changes, { render: false });
      await store.setMeta('activeProfileId', pid);
      store.tab = 'battle';
      toast('Pronto. Agora cadastre aluguel, contas e dívidas: a triagem faz o resto.', { tone: 'cyan', timeout: 5200 });
      onDone();
    };
  };
}

// ------------------------------------------------------------ Cadastro rápido (5 botões)

const KIND_TITLES = {
  boleto: 'Novo boleto', card: 'Novo cartão de crédito', person: 'Dívida com pessoa (Pix)', financing: 'Empréstimo / financiamento', vital: 'Conta vital / casa',
};

export function openObligationWizard(kind, existingId = null) {
  const ex = existingId ? store.state.obligations.find((o) => o.id === existingId) : null;
  if (ex) {
    kind = ex.type === 'vital_fixed' ? 'vital' : ex.type === 'card_debt' ? 'card' : ex.type === 'personal_debt' ? 'person' : ex.type === 'financing' ? 'financing' : 'boleto';
  }
  const pid = store.pid;
  const today = store.today;
  const multi = store.state.profiles.length > 1;
  const r = ex?.rules || {};
  let body = '';

  const legacyBlock = (checked) => `<details${checked ? ' open' : ''}><summary class="small" style="cursor:pointer">Dívida antiga, já estourada por juros?</summary>
    <div class="stack" style="margin-top:10px">
      ${checkField('isLegacy', 'Mandar para o Domo de Quarentena', checked, 'Fica fora do fluxo diário até a Era III, esperando quitação à vista com desconto.')}
      ${moneyField('principalAmount', 'Valor original (antes dos juros)', ex?.principalAmount ?? '')}
    </div></details>`;

  if (kind === 'boleto') {
    body = `
      <label class="field"><span>Cole a linha digitável ou o código de barras</span>
        <textarea class="input" name="barcode" rows="2" placeholder="23793.38128 60000.000003 ..." inputmode="numeric">${esc(ex?.barcode || '')}</textarea>
        <small id="bc-status">Lido aqui mesmo no aparelho, sem internet.</small></label>
      ${textField('beneficiary', 'Quem cobra', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Fornecedor, condomínio, escola' })}
      <div class="grid-2">
        ${moneyField('amount', 'Valor', ex?.balance ?? '', { big: true })}
        ${dateField('dueDate', 'Vencimento', ex?.dueDate || '', { hint: 'Se for parcelado: o da parcela atual.' })}
      </div>
      <label class="field"><span>É de onde?</span>${seg('bucket', [['pessoal', 'Pessoal'], ['negocio', 'Negócio'], ['casa', 'Casa']], ex?.bucket || 'pessoal')}</label>
      ${checkField('canProtest', 'Pode ir a protesto em cartório', ex ? r.canProtest : true, 'Boleto comercial costuma poder. Protesto suja o nome e custa taxa de cartório.')}
      <div class="grid-2">
        ${dateField('protestDeadline', 'Prazo até o cartório', r.protestDeadline || '', { hint: 'Se não souber: 5 dias após vencer.' })}
        ${moneyField('fee', 'Taxa de cartório estimada', r.estimatedProtestFee ?? 210)}
      </div>
      <details><summary class="small" style="cursor:pointer">Multa e juros do boleto</summary><div class="grid-2" style="margin-top:10px">
        ${numField('finePercent', 'Multa (%)', r.finePercent ?? 2)}${numField('dailyInterestPercent', 'Juros ao dia (%)', r.dailyInterestPercent ?? 0.033)}</div></details>
      ${installmentBlock(ex, { withDate: false })}
      ${legacyBlock(ex?.isLegacy)}`;
  } else if (kind === 'card') {
    const acc = ex?.accountId ? store.state.accounts.find((a) => a.id === ex.accountId) : null;
    body = `
      ${textField('name', 'Nome do cartão', acc?.name || ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Nubank, Itaú' })}
      ${moneyField('balance', 'Quanto deve no cartão hoje', ex?.balance ?? '', { big: true, hint: 'Fatura aberta + parcelas + rotativo.' })}
      ${numField('monthlyInterestPercent', 'Juros ao mês (%)', ex?.monthlyInterestPercent ?? 14, { hint: 'Rotativo costuma passar de 12% ao mês. Veja na fatura.' })}
      ${acc || !ex ? `<div class="grid-2">
        ${moneyField('limitTotal', 'Limite total', acc?.limitTotal ?? '')}
        ${moneyField('limitAvailable', 'Limite disponível', acc?.limitAvailable ?? '')}
      </div>
      <div class="grid-2">
        ${numField('closingDay', 'Dia de fechamento', acc?.closingDay ?? '', { step: 1 })}
        ${numField('dueDay', 'Dia de vencimento', acc?.dueDay ?? '', { step: 1 })}
      </div>
      ${checkField('limitShrinking', 'O banco está cortando meu limite', acc?.limitShrinking, 'Quando o limite é cortado, pagar o mínimo não devolve limite. O app vai te alertar.')}` : ''}
      ${installmentBlock(ex, { amountName: 'balance' })}
      ${legacyBlock(ex?.isLegacy)}`;
  } else if (kind === 'person') {
    body = `
      ${textField('beneficiary', 'Para quem você deve', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Mãe, Tia Célia, Léo' })}
      ${moneyField('amount', 'Quanto falta pagar (total)', ex?.balance ?? '', { big: true })}
      <label class="field"><span>Relação</span>${seg('bucket', [['familia', 'Família'], ['pessoal', 'Amigo(a)'], ['negocio', 'Trabalho']], ex?.bucket || 'familia')}</label>
      ${installmentBlock(ex)}
      <div data-single-due>${dateField('dueDate', 'Combinou alguma data? (opcional)', ex?.dueDate || '')}</div>
      <p class="tiny">Dívidas com pessoas viram vitórias rápidas: quitar primeiro traz alívio imediato.</p>`;
  } else if (kind === 'financing') {
    body = `
      ${textField('beneficiary', 'O que é', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Mercado Pago (Dinheiro Express), moto, carro' })}
      ${moneyField('received', 'Quanto caiu na sua mão', ex?.receivedAmount ?? '', { hint: 'O valor que você recebeu. Serve para mostrar quanto o empréstimo custa.' })}
      ${moneyField('amount', 'Total a pagar (o que falta)', ex?.balance ?? '', { big: true, hint: 'Se não souber, deixe em branco: o app soma as parcelas que faltam.' })}
      ${installmentBlock(ex, { forced: true })}
      ${numField('monthlyInterestPercent', 'Juros ao mês (%)', ex?.monthlyInterestPercent ?? '', { placeholder: 'Ex.: 23', hint: 'Está no app do banco, em "condições do empréstimo".' })}
      <div class="alert" data-loan-cost hidden></div>
      ${ex ? '' : (() => {
    const accs = store.state.accounts.filter((a) => a.profileId === pid && isRealLiquidity(a));
    const d = store.derive();
    const targets = d ? d.tri.frontline : [];
    return `<div class="card tight stack">
        <span class="eyebrow">O dinheiro já caiu?</span>
        <label class="field"><span>Registrar a entrada em</span><select class="input" name="receivedAccount">
          ${accs.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}
          <option value="">Não registrar entrada</option></select></label>
        ${targets.length ? `<label class="field"><span>Usou para pagar alguma conta?</span><select class="input" name="payWith">
          <option value="">Não / ainda não</option>
          ${targets.map((t) => `<option value="${esc(t.id)}">${esc(t.ob.beneficiary)} · ${brl(t.dueNow)}</option>`).join('')}</select>
          <small>O app dá baixa na conta usando o dinheiro do empréstimo.</small></label>` : ''}
      </div>`;
  })()}
      ${checkField('isWorkTool', 'É ferramenta de trabalho (moto, carro de app, máquina, insumo)', ex?.isWorkTool, 'Ferramenta de trabalho vai para a Linha de Frente: sem ela, a renda para.')}
      ${legacyBlock(ex?.isLegacy)}`;
  } else if (kind === 'vital') {
    const shareMode = ex?.shareMode === 'fixed' ? 'fixed' : 'equal';
    body = `
      ${textField('beneficiary', 'Conta', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Aluguel, Luz, Água, Pensão' })}
      <label class="field"><span>Tipo</span><select class="input" name="vitalKind">
        ${Object.entries(VITAL_KINDS).map(([k, l]) => `<option value="${k}"${(ex?.vitalKind || 'moradia') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="grid-2">
        ${moneyField('amount', 'Valor (total da conta)', ex?.totalAmount ?? '', { big: true })}
        ${dateField('dueDate', 'Vencimento', ex?.dueDate || '', { required: true })}
      </div>
      ${checkField('recurrence', 'Repete todo mês', ex ? ex.recurrence === 'monthly' : true)}
      ${multi ? `${checkField('isShared', 'Dividida com a casa (Modo Casa)', ex?.isShared, 'Cada perfil vê só a própria parte da conta.')}
        <div id="share-box" class="stack" ${ex?.isShared ? '' : 'hidden'}>
          <label class="field"><span>Como dividir</span>${seg('shareMode', [['equal', 'Partes iguais'], ['fixed', 'Minha cota fixa']], shareMode)}</label>
          ${moneyField('myShare', 'Minha cota (se fixa)', ex?.fixedShare?.[pid] ?? '')}
        </div>` : '<p class="tiny">Mora com alguém? Crie o perfil da outra pessoa para dividir contas da casa.</p>'}
      <details><summary class="small" style="cursor:pointer">Multa por atraso</summary><div class="grid-2" style="margin-top:10px">
        ${numField('finePercent', 'Multa (%)', r.finePercent ?? '')}${numField('dailyInterestPercent', 'Juros ao dia (%)', r.dailyInterestPercent ?? '')}</div></details>`;
  }

  openSheet({
    title: ex ? 'Editar' : KIND_TITLES[kind],
    body: `<form novalidate>${body}<button class="btn primary block" type="submit">${ex ? 'Salvar' : 'Adicionar à triagem'}</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      bindInstallments(form);
      const costBox = form.querySelector('[data-loan-cost]');
      if (costBox) {
        const showCost = () => {
          const rec = parseMoney(form.received.value);
          const tot = parseMoney(form.amount.value);
          const rate = realHourlyRate(store.profile);
          const cost = round2(tot - rec);
          costBox.hidden = !(rec > 0 && cost > 0);
          if (!costBox.hidden) {
            costBox.innerHTML = `${icon('alert')}<div>Você recebe ${brl(rec)} e devolve ${brl(tot)}: este empréstimo custa <b>${brl(cost)}</b>${rate > 0 ? ` = <b>${lifeTime((cost / rate) * 60)}</b> da sua vida` : ''} (${Math.round((cost / rec) * 100)}% a mais).</div>`;
          }
        };
        form.addEventListener('input', showCost);
        form.addEventListener('change', showCost);
        setTimeout(showCost, 0);
      }
      const shared = form.querySelector('[name=isShared]');
      if (shared) shared.onchange = () => { form.querySelector('#share-box').hidden = !shared.checked; };

      const bc = form.querySelector('[name=barcode]');
      if (bc) {
        const status = form.querySelector('#bc-status');
        const run = () => {
          if (!bc.value.trim()) { status.textContent = 'Lido aqui mesmo no aparelho, sem internet.'; status.className = ''; return; }
          const p = parseBoleto(bc.value, { reference: today });
          if (!p.isValid) {
            status.innerHTML = `<span class="c-magenta">${esc(p.errors[0])}</span>`;
            return;
          }
          const due = p.dueDate || p.dueDateHint;
          status.innerHTML = `<span class="c-cyan">✓ Boleto válido</span> · ${esc(p.bankName || p.segmentName || `banco ${p.bankCode}`)}${p.amount != null ? ` · ${brl(p.amount)}` : ''}${due ? ` · vence ${dateHuman(due)}` : ''}${p.warnings.length ? `<br>${esc(p.warnings[p.warnings.length - 1])}` : ''}`;
          if (p.amount != null && !form.amount.value) {
            form.amount.value = String(p.amount).replace('.', ',');
            form.amount.dataset.auto = '1';
            form.amount.dispatchEvent(new Event('change'));
          }
          if (due && !form.dueDate.value) form.dueDate.value = due;
          if (due && !form.protestDeadline.value) form.protestDeadline.value = addDays(due, 5);
          if (p.kind === 'collection') form.canProtest.checked = false;
          if (!form.beneficiary.value && p.bankName) form.beneficiary.placeholder = `Beneficiário (banco: ${p.bankName})`;
        };
        bc.addEventListener('input', run);
        if (bc.value) run();
      }

      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        try {
          const changes = await buildObligationChanges(kind, v, ex);
          const act = await store.commit(changes, { render: false, label: `${ex ? 'Edição' : 'Cadastro'}: ${v.beneficiary || v.name || 'dívida'}` });
          // empréstimo novo: entrada do dinheiro e, se pediu, baixa na conta que ele pagou
          const received = parseMoney(v.received);
          let paidMsg = '';
          if (!ex && kind === 'financing' && received > 0 && v.receivedAccount) {
            const inc = addLedgerEntry(store.state, { profileId: pid, direction: 'in', amount: received, accountId: v.receivedAccount, category: 'empréstimo', note: v.beneficiary.trim() }, { today, btcPrice: store.btcPrice() });
            await store.commit(inc.changes, { render: false, actionId: act.id });
            const target = v.payWith ? itemFor(v.payWith) : null;
            if (target) {
              const amt = round2(Math.min(received, target.dueNow));
              const pay = payObligation(store.state, { obligationId: target.id, profileId: pid, amount: amt, accountId: v.receivedAccount, date: today }, { today, btcPrice: store.btcPrice() });
              await store.commit(pay.changes, { render: false, actionId: act.id });
              paidMsg = ` ${esc(target.ob.beneficiary)} recebeu ${brl(amt)}.`;
            }
          }
          store.onChange();
          close();
          haptic();
          if (paidMsg) toast(paidMsg.trim(), { tone: 'cyan' });
        } catch (err) {
          toast(esc(err.message), { tone: 'magenta' });
        }
      };
    },
  });
}

async function buildObligationChanges(kind, v, ex) {
  const pid = store.pid;
  const today = store.today;
  const changes = { obligations: [], accounts: [] };
  const base = ex ? { ...ex } : { id: uid('obl'), profileId: pid, createdAt: new Date().toISOString(), status: 'open', zone: null };
  let amount = parseMoney(v.amount);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const legacy = Boolean(v.isLegacy);
  let ins = { fields: {}, nextDue: null };
  if (kind !== 'vital') {
    ins = readInstallments(v, kind === 'card' ? parseMoney(v.balance) : amount);
    if (kind !== 'card') amount = ins.amount;
  }

  if (kind === 'boleto') {
    need(v.beneficiary?.trim(), 'Diga quem cobra o boleto.');
    need(amount > 0, 'Informe o valor do boleto.');
    if (v.barcode?.trim()) {
      const p = parseBoleto(v.barcode, { reference: today });
      need(p.isValid, `Código inválido: ${p.errors[0]}`);
    }
    const due = v.dueDate || null;
    Object.assign(base, {
      type: legacy ? 'legacy_debt' : 'boleto', bucket: v.bucket, beneficiary: v.beneficiary.trim(), barcode: v.barcode?.replace(/\s+/g, ' ').trim() || null,
      balance: amount, principalAmount: legacy ? (parseMoney(v.principalAmount) || amount) : (ex ? ex.principalAmount : amount), dueDate: due, isLegacy: legacy,
      ...ins.fields,
      rules: {
        finePercent: num(v.finePercent), dailyInterestPercent: num(v.dailyInterestPercent), canProtest: Boolean(v.canProtest) && !legacy,
        protestDeadline: v.canProtest ? (v.protestDeadline || (due ? addDays(due, 5) : null)) : null, estimatedProtestFee: parseMoney(v.fee) || 210,
      },
    });
    if (!ex) base.principalAmount = legacy ? (parseMoney(v.principalAmount) || amount) : amount;
  } else if (kind === 'card') {
    need(v.name?.trim(), 'Dê um nome ao cartão.');
    const balance = ins.amount;
    let accountId = ex?.accountId || null;
    if (!legacy && (v.limitTotal !== undefined)) {
      const accEx = accountId ? store.state.accounts.find((a) => a.id === accountId) : null;
      const acc = normalizeAccount({
        ...(accEx || { id: uid('acc'), profileId: pid }), name: v.name.trim(), type: 'credit_card',
        limitTotal: parseMoney(v.limitTotal), limitAvailable: v.limitAvailable === '' ? parseMoney(v.limitTotal) - balance : parseMoney(v.limitAvailable),
        closingDay: num(v.closingDay) || null, dueDay: num(v.dueDay) || null, limitShrinking: Boolean(v.limitShrinking), noInstallments: Boolean(v.noInstallments),
      });
      accountId = acc.id;
      changes.accounts.push(acc);
    }
    if (balance > 0 || ex) {
      const dueDay = num(v.dueDay);
      let due = ins.nextDue || ex?.dueDate || null;
      if (!due && dueDay) {
        const [y, m] = today.split('-').map(Number);
        const cand = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dueDay, 28)).padStart(2, '0')}`;
        due = cand >= today ? cand : addDays(cand, 30);
      }
      Object.assign(base, {
        type: legacy ? 'legacy_debt' : 'card_debt', bucket: 'pessoal', beneficiary: legacy ? v.name.trim() : `Fatura ${v.name.trim()}`, accountId: legacy ? null : accountId,
        balance, principalAmount: legacy ? (parseMoney(v.principalAmount) || balance) : (ex?.principalAmount || balance),
        monthlyInterestPercent: num(v.monthlyInterestPercent), dueDate: due, isLegacy: legacy, rules: {},
        ...ins.fields,
      });
    } else {
      return changes;
    }
  } else if (kind === 'person') {
    need(v.beneficiary?.trim(), 'Para quem é a dívida?');
    need(amount > 0, 'Informe o valor.');
    Object.assign(base, {
      type: 'personal_debt', bucket: v.bucket, beneficiary: v.beneficiary.trim(), balance: amount,
      principalAmount: ex ? Math.max(ex.principalAmount, amount) : amount, dueDate: ins.nextDue || v.dueDate || null, rules: {},
      ...ins.fields,
    });
  } else if (kind === 'financing') {
    need(v.beneficiary?.trim(), 'Diga o que é o empréstimo.');
    need(amount > 0, 'Informe o total a pagar ou as parcelas.');
    const received = parseMoney(v.received);
    Object.assign(base, {
      type: legacy ? 'legacy_debt' : 'financing', bucket: 'pessoal', beneficiary: v.beneficiary.trim(), balance: amount,
      receivedAmount: received || ex?.receivedAmount || null,
      loanTotal: ex?.loanTotal || amount,
      // base do totem = o que você recebeu; o resto é juro (topo magenta)
      principalAmount: legacy ? (parseMoney(v.principalAmount) || amount) : (received > 0 && received < amount ? received : (ex ? ex.principalAmount : amount)),
      ...ins.fields,
      monthlyInterestPercent: num(v.monthlyInterestPercent), dueDate: ins.nextDue || ex?.dueDate || null, isWorkTool: Boolean(v.isWorkTool), isLegacy: legacy, rules: {},
    });
  } else if (kind === 'vital') {
    need(v.beneficiary?.trim(), 'Qual é a conta?');
    need(amount > 0, 'Informe o valor.');
    need(isISODate(v.dueDate), 'Informe o vencimento.');
    const isShared = Boolean(v.isShared);
    Object.assign(base, {
      type: 'vital_fixed', vitalKind: v.vitalKind, bucket: 'casa', beneficiary: v.beneficiary.trim(),
      totalAmount: amount, principalAmount: amount, balance: amount, dueDate: v.dueDate, recurrence: v.recurrence ? 'monthly' : null,
      isShared, shareMode: isShared ? (v.shareMode === 'fixed' ? 'fixed' : 'equal') : undefined,
      fixedShare: isShared && v.shareMode === 'fixed' ? { [pid]: parseMoney(v.myShare) } : undefined,
      paidShares: ex?.paidShares || {},
      rules: { finePercent: num(v.finePercent), dailyInterestPercent: num(v.dailyInterestPercent) },
    });
  }
  changes.obligations.push(normalizeObligation(base));
  return changes;
}

// ------------------------------------------------------------ Detalhe da obrigação

export function openObligationDetail(id) {
  const item = itemFor(id);
  if (!item) return;
  const { ob } = item;
  const d = store.derive();
  const rate = d.rate;
  const life = (v) => (rate > 0 ? lifeTime((v / rate) * 60) : '—');
  const rows = [
    ['Valor principal', brl(item.principalPart)],
    item.riskParts.accrued > 0 ? ['Juros/multa acumulados', `<span class="c-magenta">${brl(item.riskParts.accrued)}</span>`] : null,
    item.riskParts.protestRisk > 0 ? ['Risco de cartório', `<span class="c-magenta">${brl(item.riskParts.protestRisk)}</span>`] : null,
    item.bleed > 0 ? ['Sangria por mês', `<span class="c-magenta">${brl(item.bleed)} · ${life(item.bleed)} de vida</span>`] : null,
    ['Total hoje', `<b>${brl(item.updated)}</b>`],
    ob.dueDate ? ['Vencimento', item.late > 0
      ? `<span class="c-magenta"><b>${dateHuman(ob.dueDate)} · atrasada há ${item.late} dia${item.late > 1 ? 's' : ''}</b></span>`
      : item.dueSoon ? `<span class="c-amber">${dateHuman(ob.dueDate)} · ${item.daysToDue === 0 ? 'vence hoje' : `vence em ${item.daysToDue} dia${item.daysToDue > 1 ? 's' : ''}`}</span>` : dateHuman(ob.dueDate)] : null,
    item.isProtestable && ob.rules.protestDeadline ? ['Prazo do cartório', dateHuman(ob.rules.protestDeadline)] : null,
    ob.receivedAmount ? ['Você recebeu', brl(ob.receivedAmount)] : null,
    ob.receivedAmount && num(ob.loanTotal) > num(ob.receivedAmount) ? ['Custo do empréstimo', `<span class="c-magenta">${brl(num(ob.loanTotal) - num(ob.receivedAmount))} · ${lifeTime(((num(ob.loanTotal) - num(ob.receivedAmount)) / Math.max(0.01, rate)) * 60)} de vida</span>`] : null,
    item.installment ? ['Parcelas', `${item.installment.total ? `${item.installment.paid} de ${item.installment.total} pagas · ` : ''}faltam ${item.installment.left ?? '?'}x de ${brl(item.installment.amount)}`] : null,
    ob.isShared ? ['Sua cota', brl(item.open)] : null,
    num(ob.feesPaid) > 0 ? ['Juros e taxas já pagos', `<span class="c-magenta">${brl(ob.feesPaid)}</span>`] : null,
  ].filter(Boolean);
  const feeLines = (ob.feeLog || []).slice(-6).map((f) => `<div class="tiny c-ink3">${dateShort(f.date)} · ${esc((FEE_KINDS.find((k) => k[0] === f.kind) || [])[1] || 'Custo extra')} ${brl(f.amount)}${f.base > 0 ? ` (${((f.amount / f.base) * 100).toFixed(1).replace('.', ',')}%)` : ''}${f.note ? ` · ${esc(f.note)}` : ''}</div>`).join('');

  openSheet({
    title: ob.beneficiary,
    body: `<div class="stack">
      <div class="row wrap" style="gap:6px"><span class="pill ${item.zone === 'frontline' ? 'magenta' : item.zone === 'battlefield' ? 'amber' : ''}">${item.zone === 'frontline' ? 'Urgente' : item.zone === 'battlefield' ? 'Dívida na fila' : 'Guardada para depois'}</span>
        <span class="pill">${esc(item.reason)}</span>
        ${item.late > 0 ? `<span class="pill magenta">${icon('alert')}Atrasada há ${item.late} dia${item.late > 1 ? 's' : ''}</span>` : ''}</div>
      ${item.late > 0 && item.riskParts.accrued > 0 ? `<div class="alert">${icon('alert')}<div>O atraso já somou <b>${brl(item.riskParts.accrued)}</b> em multa e juros — e continua crescendo todo dia.</div></div>` : ''}
      <div class="card tight">${rows.map(([k, v]) => `<div class="row between small" style="padding:5px 0"><span class="c-ink2">${k}</span><span class="num">${v}</span></div>`).join('')}
        ${item.installment ? installmentBar(item.installment) : ''}${feeLines}</div>
      ${item.alerts.map((a) => `<div class="alert">${icon('alert')}<div>${esc(a.text)}</div></div>`).join('')}
      ${ob.barcode ? `<button class="btn sm ghost" data-copy="${esc(ob.barcode)}" type="button">${icon('copy')}Copiar linha digitável</button>` : ''}
      <div class="grid-2">
        <button class="btn primary" data-do="pay" type="button">${icon(item.isProtestable ? 'shield' : 'check')}${item.zone === 'quarantine' ? 'Quitar com desconto' : item.isProtestable ? 'Paguei antes do cartório' : 'Paguei'}</button>
        <button class="btn" data-do="script" type="button">${icon('phone')}Roteiro</button>
      </div>
      <div class="grid-2">
        <button class="btn sm" data-do="edit" type="button">${icon('edit')}Editar</button>
        <label class="field" style="gap:2px"><select class="input" data-do-zone style="min-height:34px;font-size:13px;padding:4px 8px">
          <option value="">Lugar automático</option>
          <option value="frontline"${ob.zone === 'frontline' ? ' selected' : ''}>Mover para Urgente</option>
          <option value="battlefield"${ob.zone === 'battlefield' ? ' selected' : ''}>Mover para a fila</option>
          <option value="quarantine"${ob.zone === 'quarantine' ? ' selected' : ''}>Guardar para depois</option></select></label>
      </div>
      ${ob.type === 'card_debt' && ob.installmentAmount && ob.accountId ? `<label class="field"><span>Onde mostrar esta compra parcelada</span><select class="input" data-do-tower>
        <option value="fatura"${ob.tower !== 'separada' ? ' selected' : ''}>Agrupada em cima da torre do cartão</option>
        <option value="separada"${ob.tower === 'separada' ? ' selected' : ''}>Agrupada numa torre só dela</option></select>
        <small>Vale quando você liga "Agrupar parcelas". No modo normal, só a parcela do mês entra na fatura.</small></label>` : ''}
      ${item.isProtestable ? '<button class="btn sm ghost" data-do="protested" type="button">Foi protestado (sair da contagem)</button>' : ''}
      <button class="btn sm danger" data-do="delete" type="button">${icon('trash')}Excluir</button>
    </div>`,
    onMount(el, close) {
      el.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
        if (await copyText(e.currentTarget.dataset.copy)) toast('Linha digitável copiada.');
      });
      el.querySelector('[data-do=pay]').onclick = () => { close(); openPaySheet(id, { protest: item.isProtestable, settle: item.zone === 'quarantine' }); };
      el.querySelector('[data-do=script]').onclick = () => { close(); openScriptSheet(id); };
      el.querySelector('[data-do=edit]').onclick = () => { close(); openObligationWizard(null, id); };
      el.querySelector('[data-do-zone]').onchange = async (e) => {
        await store.commit({ obligations: [{ ...ob, zone: e.target.value || null }] }, { label: `Mudou a zona: ${ob.beneficiary}` });
        close();
      };
      el.querySelector('[data-do-tower]')?.addEventListener('change', async (e) => {
        await store.commit({ obligations: [{ ...ob, tower: e.target.value }] }, { label: `Torre da compra: ${ob.beneficiary}` });
        close();
      });
      el.querySelector('[data-do=protested]')?.addEventListener('click', async () => {
        await store.commit({ obligations: [{ ...ob, protested: true }] }, { label: `Marcou protestado: ${ob.beneficiary}` });
        close();
        toast('Quitar remove o nome do cartório.', { tone: 'magenta' });
      });
      el.querySelector('[data-do=delete]').onclick = async () => {
        close();
        if (await confirmSheet({ title: 'Excluir?', text: `Remover <b>${esc(ob.beneficiary)}</b> da triagem.`, confirmLabel: 'Excluir', danger: true })) {
          await store.commit({ removeObligations: [ob.id] }, { label: `Excluiu: ${ob.beneficiary}` });
        }
      };
    },
  });
}

// ------------------------------------------------------------ Torre do cartão (fatura + compras parceladas)

export function openCardGroup(accountId) {
  const d = store.derive();
  const acc = store.state.accounts.find((a) => a.id === accountId);
  const items = d.tri.battlefield.filter((i) => i.ob.type === 'card_debt' && i.ob.accountId === accountId);
  const total = items.reduce((s, i) => s + i.updated, 0);
  const head = items.filter((i) => !i.ob.installmentAmount);
  const kids = items.filter((i) => i.ob.installmentAmount);
  const thisInvoice = round2(head.reduce((s, i) => s + i.updated, 0) + kids.reduce((s, i) => s + Math.min(i.updated, i.installment?.amount || 0), 0));
  const MS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mo = (iso) => `${MS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
  const months = (i) => {
    const n = Math.min(12, i.installment?.left || 0);
    if (!i.ob.dueDate || !n) return '';
    return `<div class="inst-months">${Array.from({ length: n }, (_, k) => `<span class="${k === 0 ? 'cur' : ''}">${mo(addMonths(i.ob.dueDate, k))}<b>${brlShort(i.installment.amount)}</b></span>`).join('')}${(i.installment.left || 0) > 12 ? '<span>…</span>' : ''}</div>`;
  };
  openSheet({
    title: /cart[aã]o/i.test(acc?.name || '') ? acc.name : `Cartão ${acc?.name || ''}`,
    body: `<div class="stack">
      <div class="card tight">
        <div class="row between small"><span>Fatura do mês <span class="c-ink3">(à vista + parcela do mês)</span></span><b class="num nowrap">${brl(thisInvoice)}</b></div>
        <div class="row between small"><span class="c-ink2">Parcelas dos próximos meses</span><span class="num">${brl(Math.max(0, total - thisInvoice))}</span></div>
        <div class="row between small" style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px"><span>Tudo o que você deve neste cartão</span><b class="num">${brl(total)}</b></div>
      </div>
      ${head.map((i) => `<button type="button" class="front-row" data-open="${esc(i.id)}">
        <span class="t">${esc(i.ob.beneficiary)}</span><span class="v num">${brl(i.updated)}</span>
        <span class="tiny">Compras à vista${i.ob.dueDate ? ` · vence ${dateHuman(i.ob.dueDate)}` : ''}</span><span></span></button>`).join('')}
      ${kids.map((i) => `<button type="button" class="front-row" data-open="${esc(i.id)}">
        <span class="t">${esc(i.ob.beneficiary)}</span><span class="v num">${brl(i.updated)}</span>
        <span class="tiny">${i.installment ? `${esc(i.installment.label)} · ${brl(i.installment.amount)} por mês` : ''} · ${i.ob.tower === 'separada' ? 'agrupada numa torre só dela' : 'agrupada em cima do cartão'}</span><span></span>
        ${months(i)}</button>`).join('')}
      <p class="tiny">Cada parcela cai na fatura do mês dela. Para ver todas juntas, use "Agrupar parcelas do cartão" na tela de dívidas. Para escolher onde a compra aparece agrupada, abra a compra.</p>
    </div>`,
    onMount(el, close) {
      el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { close(); openObligationDetail(b.dataset.open); }));
    },
  });
}

// ------------------------------------------------------------ Pagamento

export const FEE_KINDS = [['juros', 'Juros de atraso'], ['multa', 'Multa'], ['taxa', 'Taxa / tarifa'], ['iof', 'IOF'], ['encargos', 'Encargos do parcelamento'], ['outro', 'Outro']];

export function openPaySheet(id, { protest = false, settle = false } = {}) {
  const item = itemFor(id);
  if (!item) return;
  const pid = store.pid;
  const accounts = store.state.accounts.filter((a) => a.profileId === pid && isRealLiquidity(a));
  const profile = store.profile;
  const rate = realHourlyRate(profile);
  openSheet({
    title: protest ? 'Paguei antes do cartório' : settle ? 'Quitação com desconto' : 'Registrar pagamento',
    body: `<form novalidate>
      <div class="small">${esc(item.ob.beneficiary)}${item.ob.isShared ? ' · sua cota' : ''}${item.installment ? ` · ${esc(item.installment.label)}` : ''}</div>
      ${moneyField('amount', settle ? 'Valor que você vai pagar para quitar tudo' : item.installment ? 'Valor pago (uma parcela já vem preenchida)' : 'Valor pago', settle ? round2(item.updated * (1 - (item.ob.settlementDiscountPercent || 80) / 100)) : item.dueNow, { big: true })}
      ${item.installment && !settle ? `<div class="row wrap" style="gap:8px">
        <button type="button" class="btn sm" data-fill="${item.dueNow}">1 parcela · ${brl(item.dueNow)}</button>
        ${(item.installment.left ?? 0) > 1 ? `<button type="button" class="btn sm ghost" data-fill="${item.updated}">Quitar tudo · ${brl(item.updated)}</button>` : ''}
      </div>` : ''}
      ${settle ? '' : moneyField('exact', 'Valor exato que saiu da sua conta', '', { hint: 'Preencha só se foi diferente do valor acima (ex.: veio com juros, multa ou taxa).' })}
      <div id="fee-box" class="card tight stack" hidden>
        <div class="small" id="fee-text"></div>
        <label class="field"><span>Por que foi mais?</span><select class="input" name="feeKind">
          ${FEE_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        ${textField('feeNote', 'Observação (opcional)', '', { placeholder: 'Ex.: 5 dias de atraso, tarifa do boleto' })}
      </div>
      ${accounts.length ? accountSelect('accountId', accounts, accounts[0]?.id, { includeOutside: true, label: 'Saiu de qual conta' }) : '<input type="hidden" name="accountId" value="">'}
      ${dateField('date', 'Data do pagamento', store.today)}
      ${item.zone !== 'frontline' || settle ? checkField('settle', 'Paguei com desconto e quitei tudo', settle, 'Desconto por antecipação ou acordo: o que você deixou de pagar vira horas de vida.') : ''}
      <div class="card tight" id="pay-preview"></div>
      <button class="btn primary block" type="submit">${icon('check')}Confirmar</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const prev = el.querySelector('#pay-preview');
      el.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
        form.amount.value = String(round2(Number(b.dataset.fill))).replace('.', ',');
        form.amount.dispatchEvent(new Event('input', { bubbles: true }));
      }));
      const feeOf = (v, amount) => {
        const exact = parseMoney(v.exact);
        return !v.settle && exact > amount + 0.004 ? round2(exact - amount) : 0;
      };
      const preview = () => {
        const v = formData(form);
        const amount = parseMoney(v.amount);
        const fee = feeOf(v, amount);
        el.querySelector('#fee-box').hidden = !fee;
        if (fee) {
          const pct = amount > 0 ? (fee / amount) * 100 : 0;
          el.querySelector('#fee-text').innerHTML = `Você pagou <b class="c-magenta">${brl(fee)} a mais</b> (${pct.toFixed(1).replace('.', ',')}% do valor da conta). Isso não abate a dívida: foi custo. Por quê?`;
        }
        try {
          const { rescue, fullForProfile } = payObligation(store.state, { obligationId: id, profileId: pid, amount, fee, feeKind: v.feeKind, feeNote: v.feeNote, accountId: v.accountId || null, date: v.date || store.today, settle: Boolean(v.settle) }, { today: store.today, btcPrice: store.btcPrice() });
          const nextInst = item.installment && !fullForProfile && amount >= item.installment.amount - 0.01;
          prev.innerHTML = `<div class="row between"><span class="small">${fullForProfile ? 'Quita esta conta' : nextInst ? `Parcela paga · restam ${brl(Math.max(0, item.open - amount))}` : `Restam ${brl(Math.max(0, item.open - amount))}`}</span>
            <span class="num c-cyan"><b>+${lifeTime(rescue.minutes)}</b> de vida</span></div>
            ${rescue.parts.map((p) => `<div class="tiny">${esc(p.label)}: ${brl(p.amount)}</div>`).join('') || '<div class="tiny">Sem multa/juros evitados nesta data.</div>'}`;
        } catch (err) { prev.textContent = err.message; }
      };
      form.addEventListener('input', preview);
      form.addEventListener('change', preview);
      preview();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const amount = parseMoney(v.amount);
        if (amount <= 0) { toast('Informe o valor pago.', { tone: 'magenta' }); return; }
        const fee = feeOf(v, amount);
        const acc = accounts.find((a) => a.id === v.accountId);
        if (acc && acc.balance < amount + fee) {
          const ok = await confirmSheet({ title: 'Saldo insuficiente', text: `${esc(acc.name)} tem ${brl(acc.balance)}. Registrar mesmo assim (a conta fica negativa)?`, confirmLabel: 'Registrar' });
          if (!ok) return;
        }
        const { changes, rescue, fullyPaid } = payObligation(store.state, {
          obligationId: id, profileId: pid, amount, fee, feeKind: v.feeKind, feeNote: (v.feeNote || '').trim(), accountId: v.accountId || null, date: v.date || store.today, settle: Boolean(v.settle),
        }, { today: store.today, btcPrice: store.btcPrice() });
        await store.commit(changes, { label: `Pagamento: ${item.ob.beneficiary} (${brl(amount + fee)}${fee ? `, com ${brl(fee)} de ${(FEE_KINDS.find((k) => k[0] === v.feeKind) || [])[1] || 'custo extra'}` : ''})` });
        close();
        haptic([18, 40, 18, 40, 60]);
        const inst = item.installment;
        const instPaid = inst && !fullyPaid && amount >= inst.amount - 0.01;
        const discount = rescue.parts.find((x) => x.kind === 'discount');
        celebrate({
          title: fullyPaid ? 'Dívida quitada!' : instPaid ? `Parcela ${inst.current}/${inst.total} paga!` : 'Pagamento registrado',
          big: rescue.minutes > 0 ? `+${lifeTime(rescue.minutes)}` : brl(amount),
          sub: rescue.minutes > 0
            ? `de vida resgatadas${discount ? ` · desconto de ${brl(discount.amount)}` : ''}`
            : `${esc(item.ob.beneficiary)}${instPaid && inst.left > 1 ? ` · faltam ${inst.left - 1} parcela${inst.left - 1 > 1 ? 's' : ''}` : ''}`,
          blocks: inst?.total >= 2 && inst.total <= 12 ? { total: inst.total, paid: fullyPaid ? inst.total : inst.paid + (instPaid ? Math.floor((amount + 0.01) / inst.amount) : 0) } : null,
        });
      };
    },
  });
}

// ------------------------------------------------------------ Roteiro

export function openScriptSheet(id) {
  const item = itemFor(id);
  if (!item) return;
  const text = negotiationScript(item, { profileName: store.profile?.name, today: store.today });
  openSheet({
    title: 'Roteiro de ligação',
    body: `<div class="stack"><p class="small">Leia com calma, anote nome do atendente e número de protocolo. Nunca aceite proposta sem ver por escrito.</p>
      <textarea class="input" rows="10" style="font-family:var(--font);font-size:14.5px">${esc(text)}</textarea>
      <button class="btn primary block" type="button" data-copy>${icon('copy')}Copiar roteiro</button></div>`,
    onMount(el) {
      el.querySelector('[data-copy]').onclick = async () => {
        const ok = await copyText(el.querySelector('textarea').value);
        toast(ok ? 'Roteiro copiado.' : 'Não deu para copiar. Selecione o texto e copie.', { tone: ok ? 'cyan' : 'magenta' });
      };
    },
  });
}

// ------------------------------------------------------------ Lançamentos

const CATEGORIES_OUT = ['mercado', 'transporte', 'casa', 'saúde', 'trabalho', 'lazer', 'pagamento', 'outros'];
const CATEGORIES_IN = ['salário', 'adiantamento', 'extra', 'venda', 'reembolso', 'outros'];

export function openEntrySheet({ dir = 'out', accountId = null } = {}) {
  const pid = store.pid;
  const accounts = store.state.accounts.filter((a) => a.profileId === pid);
  if (!accounts.length) {
    toast('Cadastre uma conta antes de lançar.', { tone: 'magenta' });
    openAccountWizard();
    return;
  }
  const selected = accountId || accounts.find(isRealLiquidity)?.id || accounts[0].id;
  openSheet({
    title: 'Lançamento rápido',
    body: `<form novalidate>
      ${seg('direction', [['in', '+ Entrou'], ['out', '− Saiu']], dir, 'inout')}
      ${moneyField('amount', 'Valor', '', { big: true })}
      <div id="liq-box" hidden class="stack">
        <b class="small">Esse dinheiro caiu como...</b>
        ${seg('liq', [['pix', 'Pix / conta (livre)'], ['locked', 'Vale / cartão (travado)']], 'pix')}
      </div>
      ${accountSelect('accountId', accounts, selected)}
      <div class="tiny" id="acc-hint"></div>
      <label class="field"><span>Categoria</span><select class="input" name="category"></select></label>
      ${textField('note', 'Descrição (opcional)', '', { placeholder: 'Ex.: mercado, uber, bico' })}
      ${dateField('date', 'Data', store.today, { hint: 'Data futura = agendado (entra na Onda de Liquidez).' })}
      <div id="inst-box" hidden>${numField('installments', 'Parcelas (1 = à vista)', 1, { step: 1 })}<div class="tiny" id="inst-hint"></div>
        <div id="tower-box" hidden class="stack"><b class="small">Onde mostrar essa compra nas torres?</b>
          ${seg('tower', [['fatura', 'Dentro da torre do cartão'], ['separada', 'Torre só dela']], 'fatura')}
          <div class="tiny" id="tower-hint"></div></div></div>
      <button class="btn primary block" type="submit">Lançar</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      const sync = () => {
        const v = formData(form);
        const acc = accounts.find((a) => a.id === v.accountId);
        const cats = [...(v.direction === 'in' ? CATEGORIES_IN : CATEGORIES_OUT), ...customCategories(store.state, pid, v.direction === 'in' ? 'entrada' : 'saida')];
        const sel = form.category;
        if (sel.dataset.dir !== v.direction) {
          sel.innerHTML = cats.map((c) => `<option>${c}</option>`).join('');
          sel.dataset.dir = v.direction;
        }
        const hint = {
          checking_cash: 'Mexe no caixa real de hoje.',
          benefit_card: 'Saldo restrito: não mexe no caixa real.',
          credit_card: v.direction === 'out' ? 'Compra no crédito: usa limite, não mexe no caixa hoje e aumenta a fatura.' : 'Estorno no cartão: devolve limite e abate a fatura.',
          savings_pot: 'Mexe só no cofrinho (não é caixa livre).',
          collateralized_yield_crypto: v.direction === 'out' ? 'Gasto no cartão com garantia: gera cashback em sats.' : 'Depósito na garantia (rende CDI em BTC).',
        }[acc?.type] || '';
        el.querySelector('#acc-hint').textContent = hint;
        const canInst = ['credit_card', 'collateralized_yield_crypto'].includes(acc?.type) && !acc?.noInstallments && v.direction === 'out';
        el.querySelector('#inst-box').hidden = !canInst;
        const n = Math.max(1, Math.round(num(v.installments, 1)) || 1);
        const amt = parseMoney(v.amount);
        el.querySelector('#inst-hint').textContent = canInst && n > 1 && amt > 0
          ? `${n}x de ${brl(round2(amt / n))}. Usa ${brl(amt)} do limite agora e a fatura se divide em ${n} partes (a 1ª vence ${dateHuman(invoiceDue(acc, v.date || store.today))}). Cada parcela paga devolve limite.`
          : acc?.type === 'collateralized_yield_crypto' ? 'Parcelado trava garantia até pagar cada parcela.' : '';
        el.querySelector('#tower-box').hidden = !(canInst && n > 1 && amt > 0);
        el.querySelector('#tower-hint').textContent = v.tower === 'separada'
          ? `No dia a dia, só a parcela do mês (${brl(round2(amt / n))}) entra na fatura do cartão. Com "Agrupar parcelas" ligado, esta compra ganha uma torre ao lado com os ${n} blocos.`
          : `No dia a dia, só a parcela do mês (${brl(round2(amt / n))}) entra na fatura do cartão. Com "Agrupar parcelas" ligado, os ${n} blocos aparecem em cima da torre do cartão.`;
      };
      form.addEventListener('input', sync);
      form.addEventListener('change', (ev) => {
        if (ev.target.name === 'liq') {
          const want = ev.target.value === 'locked' ? 'benefit_card' : 'checking_cash';
          const match = accounts.find((a) => a.type === want);
          if (match) form.accountId.value = match.id;
          else if (want === 'benefit_card') { toast('Cadastre o cartão de benefício primeiro.'); openAccountWizard(); return; }
        }
        el.querySelector('#liq-box').hidden = form.direction.value !== 'in';
        sync();
      });
      el.querySelector('#liq-box').hidden = form.direction.value !== 'in';
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const amount = parseMoney(v.amount);
        if (amount <= 0) { toast('Informe o valor.', { tone: 'magenta' }); return; }
        const { changes, entry } = addLedgerEntry(store.state, {
          profileId: pid, direction: v.direction, amount, accountId: v.accountId, category: v.category, note: v.note.trim(),
          date: v.date || store.today, installments: num(v.installments, 1), tower: v.tower || 'fatura',
        }, { today: store.today, btcPrice: store.btcPrice() });
        await store.commit(changes, { label: `${v.direction === 'in' ? 'Entrada' : 'Saída'}: ${v.note.trim() || v.category} (${brl(amount)})` });
        close();
        haptic();
        if (entry.status === 'scheduled') toast(`Agendado para ${dateHuman(entry.date)}: entra na Onda nesse dia.`);
      };
    },
  });
}

export async function removeEntry(id) {
  const action = store.actionForLedger(id);
  if (action) {
    const lines = describeAction(action, store.state);
    const ok = await confirmSheet({
      title: 'Desfazer esta ação inteira?',
      text: `<b>${esc(action.label)}</b><br>Tudo o que foi feito junto volta como estava:<ul class="reasons">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`,
      confirmLabel: 'Desfazer tudo',
    });
    if (!ok) return;
    await store.undo(action.id);
    toast('Desfeito. Saldos e dívidas voltaram ao que eram.', { tone: 'cyan' });
    return;
  }
  const e = store.state.ledger.find((x) => x.id === id);
  if (!await confirmSheet({ title: 'Desfazer lançamento?', text: `${e?.direction === 'in' ? 'A entrada sai' : 'O valor volta'} da conta de origem${e?.obligationId ? ' e a dívida volta a ficar em aberto' : ''}.`, confirmLabel: 'Desfazer' })) return;
  const changes = removeLedgerEntry(store.state, id);
  if (e?.obligationId) {
    const ob = store.state.obligations.find((o) => o.id === e.obligationId);
    if (ob) changes.obligations = [...(changes.obligations || []), { ...ob, status: 'open', paidAt: null, balance: round2(num(ob.balance) + num(e.amount)) }];
  }
  await store.commit(changes);
  toast('Lançamento desfeito.');
}

// ------------------------------------------------------------ Contas

const SWITCHABLE = ['checking_cash', 'savings_pot'];

export function openAccountWizard(existingId = null) {
  const ex = existingId ? store.state.accounts.find((a) => a.id === existingId) : null;
  const type = ex?.type || 'checking_cash';
  openSheet({
    title: ex ? `Editar ${ex.name}` : 'Nova conta ou cartão',
    body: `<form novalidate>
      <label class="field"><span>Tipo</span><select class="input" name="type"${ex && !SWITCHABLE.includes(ex.type) ? ' disabled' : ''}>
        ${Object.entries(ACCOUNT_TYPES).filter(([k]) => !ex || !SWITCHABLE.includes(ex.type) || SWITCHABLE.includes(k)).map(([k, t]) => `<option value="${k}"${k === type ? ' selected' : ''}>${t.label}</option>`).join('')}</select>
        ${ex && SWITCHABLE.includes(ex.type) ? '<small>Conta e cofrinho podem trocar de tipo: o saldo continua o mesmo. Cofrinho não conta como dinheiro livre até você mover para o Pix.</small>' : ''}</label>
      ${textField('name', 'Nome', ex?.name || '', { required: true, placeholder: 'Ex.: Nubank, Caju, Bipa' })}
      <div data-t="checking_cash benefit_card savings_pot">${moneyField('balance', 'Saldo atual', ex?.balance ?? '', { big: true })}</div>
      <div data-t="savings_pot" class="stack">
        ${numField('cdiPercent', '% do CDI que rende', ex?.cdiPercent ?? 100)}
        <p class="tiny">Cofrinho (Bipa, Mercado Pago, Nubank…). O dinheiro daqui só vira Pix depois que você usa "⇄ Mover saldo".</p>
      </div>
      <div data-t="benefit_card" class="stack">
        <label class="field"><span>Esse saldo serve para</span><select class="input" name="lock">
          ${[['alimentacao', 'Alimentação / mercado'], ['transporte', 'Transporte'], ['outro', 'Outro uso']].map(([k, l]) => `<option value="${k}"${(ex?.lock || 'alimentacao') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="tiny">Saldo travado: só funciona no cartão e nunca paga aluguel, boleto ou dívida.</p>
      </div>
      <div data-t="credit_card" class="stack">
        <div class="grid-2">${moneyField('limitTotal', 'Limite total', ex?.limitTotal ?? '')}${moneyField('limitAvailable', 'Disponível', ex?.limitAvailable ?? '')}</div>
        <div class="grid-2">${numField('closingDay', 'Fechamento (dia)', ex?.closingDay ?? '', { step: 1 })}${numField('dueDay', 'Vencimento (dia)', ex?.dueDay ?? '', { step: 1 })}</div>
        ${checkField('limitShrinking', 'O banco está cortando meu limite', ex?.limitShrinking)}
        ${checkField('noInstallments', 'Este cartão NÃO faz parcelamento', ex?.noInstallments, 'Por padrão todo cartão parcela. Marque só se o seu não aceita compra parcelada.')}
        <p class="tiny">A dívida do cartão entra pelo botão "+ Cartão" no Campo de Batalha.</p>
      </div>
      <div data-t="collateralized_yield_crypto" class="stack">
        <div class="grid-2">${moneyField('collateralTotal', 'Garantia total depositada', ex?.collateralTotal ?? '')}${moneyField('lockedInstallments', 'Travado em parcelas', ex?.lockedInstallments ?? '')}</div>
        <div class="grid-2">${numField('cdiPercent', '% do CDI', ex?.yieldConfig?.cdiPercent ?? 100)}${numField('cashbackPercent', 'Cashback (%)', ex?.yieldConfig?.cashbackPercent ?? 0.5)}</div>
        ${checkField('noInstallments', 'Este cartão NÃO faz parcelamento', ex?.noInstallments)}
        <p class="tiny">Modelo Bipa: a garantia rende CDI pago em BTC e o limite livre é garantia − parcelas travadas. Nada disso conta como dinheiro para o aluguel.</p>
      </div>
      <button class="btn primary block" type="submit">Salvar</button>
      ${ex ? `<button class="btn danger block" type="button" data-del>${icon('trash')}Excluir conta</button>` : ''}
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const sync = () => {
        const t = form.type.value;
        for (const box of el.querySelectorAll('[data-t]')) box.hidden = !box.dataset.t.split(' ').includes(t);
      };
      form.type.onchange = sync;
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const t = ex && !SWITCHABLE.includes(ex.type) ? ex.type : v.type || ex?.type;
        if (!v.name.trim()) { toast('Dê um nome à conta.', { tone: 'magenta' }); return; }
        const acc = normalizeAccount({
          ...(ex || { id: uid('acc'), profileId: store.pid }), type: t, name: v.name.trim(),
          balance: parseMoney(v.balance), lock: v.lock, cdiPercent: num(v.cdiPercent, 100), limitTotal: parseMoney(v.limitTotal),
          limitAvailable: v.limitAvailable === '' ? parseMoney(v.limitTotal) : parseMoney(v.limitAvailable),
          closingDay: num(v.closingDay) || null, dueDay: num(v.dueDay) || null, limitShrinking: Boolean(v.limitShrinking),
          collateralTotal: parseMoney(v.collateralTotal), lockedInstallments: parseMoney(v.lockedInstallments),
          yieldConfig: { cdiPercent: num(v.cdiPercent, 100), cashbackPercent: num(v.cashbackPercent, 0.5), payoutAsset: 'BTC' },
        });
        if (t === 'credit_card' && ex && ex.limitTotal !== acc.limitTotal) {
          acc.limitHistory = [...(ex.limitHistory || []), { date: store.today, limitTotal: acc.limitTotal }];
        }
        await store.commit({ accounts: [acc] }, { label: `Conta: ${acc.name}` });
        close();
      };
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (await confirmSheet({ title: 'Excluir conta?', text: 'Os lançamentos ficam no histórico, mas a conta sai do deck.', confirmLabel: 'Excluir', danger: true })) {
          await store.commit({ removeAccounts: [ex.id] }, { label: `Excluiu conta: ${ex.name}` });
        }
      });
    },
  });
}

// ------------------------------------------------------------ Perfis

export function openProfileWizard(existingId = null) {
  const ex = existingId ? store.state.profiles.find((p) => p.id === existingId) : null;
  openSheet({
    title: ex ? 'Meu perfil' : 'Novo perfil na casa',
    body: `<form novalidate>
      ${ex ? '' : '<p class="small">Cada perfil tem dívidas e contas isoladas. Contas marcadas como da casa (aluguel, luz) são divididas entre todos.</p>'}
      ${textField('name', 'Nome', ex?.name || '', { required: true })}
      ${moneyField('income', 'Renda líquida por mês', ex?.monthlyNetIncome ?? '', { big: true })}
      <div class="grid-2">${numField('work', 'Horas de trabalho/mês', ex?.monthlyWorkHours ?? 176)}${numField('commute', 'Horas de deslocamento/mês', ex?.monthlyCommuteHours ?? 44)}</div>
      <label class="field"><span>Micro-escudo (meta da Era I)</span>
        ${seg('shield', [['500', 'R$ 500'], ['750', 'R$ 750'], ['1000', 'R$ 1.000']], String(ex?.shieldTarget || 500))}</label>
      ${ex ? '' : moneyField('cash', 'Saldo em conta corrente hoje', '')}
      <button class="btn primary block" type="submit">${ex ? 'Salvar' : 'Criar perfil'}</button>
      ${ex && store.state.profiles.length > 1 ? `<button class="btn danger block" type="button" data-del>${icon('trash')}Excluir este perfil e os dados dele</button>` : ''}
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        if (!v.name.trim()) { toast('Informe o nome.', { tone: 'magenta' }); return; }
        const hues = [190, 320, 45, 140, 265];
        const p = normalizeProfile({
          ...(ex || { id: uid('prof'), createdAt: new Date().toISOString(), hue: hues[store.state.profiles.length % hues.length] }),
          name: v.name.trim(), monthlyNetIncome: parseMoney(v.income), monthlyWorkHours: num(v.work), monthlyCommuteHours: num(v.commute), shieldTarget: num(v.shield, 500),
        });
        const changes = { profiles: [p], accounts: [] };
        ensureHousehold(changes);
        if (!ex) changes.accounts.push(normalizeAccount({ id: uid('acc'), profileId: p.id, name: 'Conta Corrente', type: 'checking_cash', balance: parseMoney(v.cash) }));
        await store.commit(changes, { render: false, label: ex ? `Perfil: ${p.name}` : `Novo perfil: ${p.name}` });
        if (!ex) await store.setMeta('activeProfileId', p.id);
        store.onChange();
        close();
        toast(ex ? 'Perfil atualizado.' : `Perfil ${esc(p.name)} criado.`, { tone: 'cyan' });
      };
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        const ok = await confirmSheet({ title: `Excluir ${esc(ex.name)}?`, text: 'Apaga as contas, dívidas e lançamentos deste perfil neste aparelho.', confirmLabel: 'Excluir', danger: true });
        if (!ok) return;
        const changes = {
          removeProfiles: [ex.id],
          removeAccounts: store.state.accounts.filter((a) => a.profileId === ex.id).map((a) => a.id),
          removeObligations: store.state.obligations.filter((o) => o.profileId === ex.id).map((o) => o.id),
          removeLedger: store.state.ledger.filter((t) => t.profileId === ex.id).map((t) => t.id),
        };
        await store.commit(changes, { render: false, label: `Excluiu o perfil ${ex.name}` });
        await store.setMeta('activeProfileId', store.state.profiles[0]?.id || null);
        store.onChange();
        toast('Perfil excluído.');
      });
    },
  });
}

// ------------------------------------------------------------ Satoshis

export function openAporteSheet() {
  const d = store.derive();
  const price = store.btcPrice();
  if (d.eras.lock.locked) {
    toast('Trava de segurança: primeiro resolva as contas urgentes e as essenciais dos próximos 15 dias.', { tone: 'magenta' });
    return;
  }
  const accounts = store.state.accounts.filter((a) => a.profileId === store.pid && isRealLiquidity(a));
  openSheet({
    title: 'Registrar aporte em BTC',
    body: `<form novalidate>
      <p class="small">Excedente real disponível: <b class="c-cyan">${brl(d.eras.lock.excess)}</b> (dinheiro − contas essenciais − reserva).</p>
      ${moneyField('amount', 'Valor em reais', '', { big: true })}
      ${moneyField('price', 'Preço do BTC (R$)', price || '', { hint: 'Cotação ao vivo; ajuste para o preço que você pagou.' })}
      ${accounts.length ? accountSelect('accountId', accounts, accounts[0].id, { label: 'Saiu de qual conta' }) : ''}
      <div class="tiny" id="ap-prev"></div>
      <button class="btn primary block" type="submit">${icon('btc')}Registrar</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const prev = () => {
        const v = formData(form);
        const s = brlToSats(parseMoney(v.amount), parseMoney(v.price));
        el.querySelector('#ap-prev').innerHTML = s ? `= <b class="c-cyan">${s.toLocaleString('pt-BR')} sats</b>` : '';
      };
      form.addEventListener('input', prev);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const amount = parseMoney(v.amount);
        const p = parseMoney(v.price);
        if (amount <= 0 || p <= 0) { toast('Informe valor e preço.', { tone: 'magenta' }); return; }
        if (amount > d.eras.lock.excess + 0.01) { toast(`Acima do excedente real (${brl(d.eras.lock.excess)}). A trava protege seu caixa.`, { tone: 'magenta' }); return; }
        const s = brlToSats(amount, p);
        const profile = { ...store.profile, accumulatedSats: num(store.profile.accumulatedSats) + s };
        profile.satsLog = [{ id: uid('sat'), date: store.today, sats: s, brl: amount, price: p }, ...(profile.satsLog || [])].slice(0, 200);
        const changes = { profiles: [profile] };
        if (v.accountId) {
          const { changes: c } = addLedgerEntry(store.state, { profileId: store.pid, direction: 'out', amount, accountId: v.accountId, category: 'aporte BTC', note: `Aporte ${s.toLocaleString('pt-BR')} sats` }, { today: store.today });
          Object.assign(changes, { ledger: c.ledger, accounts: c.accounts });
        }
        await store.commit(changes, { label: `Aporte: ${s.toLocaleString('pt-BR')} sats` });
        close();
        toast(`+${s.toLocaleString('pt-BR')} sats rumo a 1 BTC.`, { tone: 'cyan', iconName: 'btc' });
      };
    },
  });
}

export function openSatsUpdateSheet() {
  const profile = store.profile;
  openSheet({
    title: 'Saldo em autocustódia',
    body: `<form novalidate>
      <p class="small">Quantos sats você já tem na sua carteira (aportes antigos)? Isso só atualiza o placar, não mexe no caixa.</p>
      ${numField('sats', 'Sats em autocustódia', profile.accumulatedSats, { step: 1 })}
      <button class="btn primary block" type="submit">Salvar</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        await store.commit({ profiles: [{ ...profile, accumulatedSats: Math.max(0, Math.floor(num(form.sats.value))) }] }, { label: 'Atualizou sats' });
        close();
      };
    },
  });
}

export { moneyToMinutes };
