// Wizards e formulários: onboarding, cadastro rápido (5 botões), pagamento, lançamentos, contas, perfis.

import { store } from '../store.js';
import {
  esc, openSheet, toast, formData, bindSegments, copyText, confirmSheet, haptic,
} from './dom.js';
import { icon } from './icons.js';
import { brl, lifeTime, parseMoney, dateHuman } from '../core/format.js';
import { addDays, isISODate } from '../core/dates.js';
import { uid, num, round2 } from '../core/util.js';
import {
  normalizeAccount, normalizeObligation, normalizeProfile, normalizeHousehold, VITAL_KINDS, ACCOUNT_TYPES, isRealLiquidity,
} from '../core/model.js';
import { parseBoleto } from '../parsers/boletoParser.js';
import { payObligation, addLedgerEntry, removeLedgerEntry } from '../engines/cashflow.js';
import { buildItem, memberIds } from '../engines/triage.js';
import { negotiationScript } from '../engines/scripts.js';
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
    <button class="btn block" data-ob="demo">${icon('spark')}Carregar Cenário Realista de Teste</button>
    <p class="tiny" style="text-align:center">O cenário de teste usa dados fictícios e pode ser apagado com um toque.</p>
  </div>`;

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
  boleto: 'Novo boleto', card: 'Novo cartão de crédito', person: 'Dívida com pessoa (Pix)', financing: 'Financiamento / empréstimo', vital: 'Conta vital / casa',
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
        ${dateField('dueDate', 'Vencimento', ex?.dueDate || '')}
      </div>
      <label class="field"><span>É de onde?</span>${seg('bucket', [['pessoal', 'Pessoal'], ['negocio', 'Negócio'], ['casa', 'Casa']], ex?.bucket || 'pessoal')}</label>
      ${checkField('canProtest', 'Pode ir a protesto em cartório', ex ? r.canProtest : true, 'Boleto comercial costuma poder. Protesto suja o nome e custa taxa de cartório.')}
      <div class="grid-2">
        ${dateField('protestDeadline', 'Prazo até o cartório', r.protestDeadline || '', { hint: 'Se não souber: 5 dias após vencer.' })}
        ${moneyField('fee', 'Taxa de cartório estimada', r.estimatedProtestFee ?? 210)}
      </div>
      <details><summary class="small" style="cursor:pointer">Multa e juros do boleto</summary><div class="grid-2" style="margin-top:10px">
        ${numField('finePercent', 'Multa (%)', r.finePercent ?? 2)}${numField('dailyInterestPercent', 'Juros ao dia (%)', r.dailyInterestPercent ?? 0.033)}</div></details>
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
      ${legacyBlock(ex?.isLegacy)}`;
  } else if (kind === 'person') {
    body = `
      ${textField('beneficiary', 'Para quem você deve', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Mãe, Tia Célia, Léo' })}
      ${moneyField('amount', 'Quanto', ex?.balance ?? '', { big: true })}
      <label class="field"><span>Relação</span>${seg('bucket', [['familia', 'Família'], ['pessoal', 'Amigo(a)'], ['negocio', 'Trabalho']], ex?.bucket || 'familia')}</label>
      ${dateField('dueDate', 'Combinou alguma data? (opcional)', ex?.dueDate || '')}
      <p class="tiny">Dívidas com pessoas viram Quick Wins: quitá-las primeiro traz alívio emocional imediato.</p>`;
  } else if (kind === 'financing') {
    body = `
      ${textField('beneficiary', 'O que é', ex?.beneficiary || '', { required: true, placeholder: 'Ex.: Empréstimo pessoal, moto, carro' })}
      ${moneyField('amount', 'Saldo devedor total', ex?.balance ?? '', { big: true })}
      <div class="grid-2">
        ${moneyField('installmentAmount', 'Valor da parcela', ex?.installmentAmount ?? '')}
        ${numField('installmentsLeft', 'Parcelas restantes', ex?.installmentsLeft ?? '', { step: 1 })}
      </div>
      <div class="grid-2">
        ${dateField('dueDate', 'Próximo vencimento', ex?.dueDate || '')}
        ${numField('monthlyInterestPercent', 'Juros ao mês (%)', ex?.monthlyInterestPercent ?? '', { placeholder: 'Ex.: 6,9' })}
      </div>
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
      ${multi ? `${checkField('isShared', 'Dividida com a casa (Modo Casa)', ex?.isShared, 'Cada perfil vê só a própria cota na Linha d\'Água.')}
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
          if (p.amount != null && !form.amount.value) form.amount.value = String(p.amount).replace('.', ',');
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
          await store.commit(changes);
          close();
          haptic();
          toast(ex ? 'Atualizado.' : 'Na triagem. Veja onde caiu no Campo de Batalha.', { tone: 'cyan' });
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
  const amount = parseMoney(v.amount);
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const legacy = Boolean(v.isLegacy);

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
      rules: {
        finePercent: num(v.finePercent), dailyInterestPercent: num(v.dailyInterestPercent), canProtest: Boolean(v.canProtest) && !legacy,
        protestDeadline: v.canProtest ? (v.protestDeadline || (due ? addDays(due, 5) : null)) : null, estimatedProtestFee: parseMoney(v.fee) || 210,
      },
    });
    if (!ex) base.principalAmount = legacy ? (parseMoney(v.principalAmount) || amount) : amount;
  } else if (kind === 'card') {
    need(v.name?.trim(), 'Dê um nome ao cartão.');
    const balance = parseMoney(v.balance);
    let accountId = ex?.accountId || null;
    if (!legacy && (v.limitTotal !== undefined)) {
      const accEx = accountId ? store.state.accounts.find((a) => a.id === accountId) : null;
      const acc = normalizeAccount({
        ...(accEx || { id: uid('acc'), profileId: pid }), name: v.name.trim(), type: 'credit_card',
        limitTotal: parseMoney(v.limitTotal), limitAvailable: v.limitAvailable === '' ? parseMoney(v.limitTotal) - balance : parseMoney(v.limitAvailable),
        closingDay: num(v.closingDay) || null, dueDay: num(v.dueDay) || null, limitShrinking: Boolean(v.limitShrinking),
      });
      accountId = acc.id;
      changes.accounts.push(acc);
    }
    if (balance > 0 || ex) {
      const dueDay = num(v.dueDay);
      let due = ex?.dueDate || null;
      if (!due && dueDay) {
        const [y, m] = today.split('-').map(Number);
        const cand = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dueDay, 28)).padStart(2, '0')}`;
        due = cand >= today ? cand : addDays(cand, 30);
      }
      Object.assign(base, {
        type: legacy ? 'legacy_debt' : 'card_debt', bucket: 'pessoal', beneficiary: legacy ? v.name.trim() : `Fatura ${v.name.trim()}`, accountId: legacy ? null : accountId,
        balance, principalAmount: legacy ? (parseMoney(v.principalAmount) || balance) : (ex?.principalAmount || balance),
        monthlyInterestPercent: num(v.monthlyInterestPercent), dueDate: due, isLegacy: legacy, rules: {},
      });
    } else {
      return changes;
    }
  } else if (kind === 'person') {
    need(v.beneficiary?.trim(), 'Para quem é a dívida?');
    need(amount > 0, 'Informe o valor.');
    Object.assign(base, {
      type: 'personal_debt', bucket: v.bucket, beneficiary: v.beneficiary.trim(), balance: amount,
      principalAmount: ex ? ex.principalAmount : amount, dueDate: v.dueDate || null, rules: {},
    });
  } else if (kind === 'financing') {
    need(v.beneficiary?.trim(), 'Diga o que é o financiamento.');
    need(amount > 0, 'Informe o saldo devedor.');
    Object.assign(base, {
      type: legacy ? 'legacy_debt' : 'financing', bucket: 'pessoal', beneficiary: v.beneficiary.trim(), balance: amount,
      principalAmount: legacy ? (parseMoney(v.principalAmount) || amount) : (ex ? ex.principalAmount : amount),
      installmentAmount: parseMoney(v.installmentAmount) || null, installmentsLeft: v.installmentsLeft === '' ? null : num(v.installmentsLeft),
      monthlyInterestPercent: num(v.monthlyInterestPercent), dueDate: v.dueDate || null, isWorkTool: Boolean(v.isWorkTool), isLegacy: legacy, rules: {},
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
    ob.dueDate ? ['Vencimento', dateHuman(ob.dueDate)] : null,
    item.isProtestable && ob.rules.protestDeadline ? ['Prazo do cartório', dateHuman(ob.rules.protestDeadline)] : null,
    ob.installmentAmount ? ['Parcela', `${brl(ob.installmentAmount)}${ob.installmentsLeft != null ? ` · faltam ${ob.installmentsLeft}` : ''}`] : null,
    ob.isShared ? ['Sua cota', brl(item.open)] : null,
  ].filter(Boolean);

  openSheet({
    title: ob.beneficiary,
    body: `<div class="stack">
      <div class="row wrap" style="gap:6px"><span class="pill ${item.zone === 'frontline' ? 'magenta' : item.zone === 'battlefield' ? 'amber' : ''}">${item.zone === 'frontline' ? 'Zona 1 · Linha de Frente' : item.zone === 'battlefield' ? 'Zona 2 · Campo de Batalha' : 'Zona 3 · Quarentena'}</span>
        <span class="pill">${esc(item.reason)}</span></div>
      <div class="card tight">${rows.map(([k, v]) => `<div class="row between small" style="padding:5px 0"><span class="c-ink2">${k}</span><span class="num">${v}</span></div>`).join('')}</div>
      ${item.alerts.map((a) => `<div class="alert">${icon('alert')}<div>${esc(a.text)}</div></div>`).join('')}
      ${ob.barcode ? `<button class="btn sm ghost" data-copy="${esc(ob.barcode)}" type="button">${icon('copy')}Copiar linha digitável</button>` : ''}
      <div class="grid-2">
        <button class="btn primary" data-do="pay" type="button">${icon(item.isProtestable ? 'shield' : 'check')}${item.zone === 'quarantine' ? 'Quitar com desconto' : item.isProtestable ? 'Protesto Segurado' : 'Pagar'}</button>
        <button class="btn" data-do="script" type="button">${icon('phone')}Roteiro</button>
      </div>
      <div class="grid-2">
        <button class="btn sm" data-do="edit" type="button">${icon('edit')}Editar</button>
        <label class="field" style="gap:2px"><select class="input" data-do-zone style="min-height:34px;font-size:13px;padding:4px 8px">
          <option value="">Zona automática</option>
          <option value="frontline"${ob.zone === 'frontline' ? ' selected' : ''}>Forçar Zona 1</option>
          <option value="battlefield"${ob.zone === 'battlefield' ? ' selected' : ''}>Forçar Zona 2</option>
          <option value="quarantine"${ob.zone === 'quarantine' ? ' selected' : ''}>Forçar Zona 3</option></select></label>
      </div>
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
        await store.commit({ obligations: [{ ...ob, zone: e.target.value || null }] });
        toast('Zona atualizada.');
        close();
      };
      el.querySelector('[data-do=protested]')?.addEventListener('click', async () => {
        await store.commit({ obligations: [{ ...ob, protested: true }] });
        close();
        toast('Marcado como protestado. Quitar remove o nome do cartório.', { tone: 'magenta' });
      });
      el.querySelector('[data-do=delete]').onclick = async () => {
        close();
        if (await confirmSheet({ title: 'Excluir?', text: `Remover <b>${esc(ob.beneficiary)}</b> da triagem.`, confirmLabel: 'Excluir', danger: true })) {
          await store.commit({ removeObligations: [ob.id] });
          toast('Excluído.');
        }
      };
    },
  });
}

// ------------------------------------------------------------ Pagamento

export function openPaySheet(id, { protest = false, settle = false } = {}) {
  const item = itemFor(id);
  if (!item) return;
  const pid = store.pid;
  const accounts = store.state.accounts.filter((a) => a.profileId === pid && isRealLiquidity(a));
  const profile = store.profile;
  const rate = realHourlyRate(profile);
  openSheet({
    title: protest ? 'Protesto Segurado' : settle ? 'Quitação com desconto' : 'Registrar pagamento',
    body: `<form novalidate>
      <div class="small">${esc(item.ob.beneficiary)}${item.ob.isShared ? ' · sua cota' : ''}</div>
      ${moneyField('amount', settle ? 'Valor que você vai pagar para quitar tudo' : 'Valor pago', settle ? round2(item.updated * (1 - (item.ob.settlementDiscountPercent || 80) / 100)) : item.dueNow, { big: true })}
      ${accounts.length ? accountSelect('accountId', accounts, accounts[0]?.id, { includeOutside: true, label: 'Saiu de qual conta' }) : '<input type="hidden" name="accountId" value="">'}
      ${dateField('date', 'Data do pagamento', store.today)}
      ${item.zone !== 'frontline' || settle ? checkField('settle', 'Este valor quita a dívida inteira (acordo com desconto)', settle) : ''}
      <div class="card tight" id="pay-preview"></div>
      <button class="btn primary block" type="submit">${icon('check')}Confirmar</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const prev = el.querySelector('#pay-preview');
      const preview = () => {
        const v = formData(form);
        const amount = parseMoney(v.amount);
        try {
          const { rescue, fullForProfile } = payObligation(store.state, { obligationId: id, profileId: pid, amount, accountId: v.accountId || null, date: v.date || store.today, settle: Boolean(v.settle) }, { today: store.today, btcPrice: store.btcPrice() });
          prev.innerHTML = `<div class="row between"><span class="small">${fullForProfile ? 'Quita esta conta' : `Restam ${brl(Math.max(0, item.open - amount))}`}</span>
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
        const acc = accounts.find((a) => a.id === v.accountId);
        if (acc && acc.balance < amount) {
          const ok = await confirmSheet({ title: 'Saldo insuficiente', text: `${esc(acc.name)} tem ${brl(acc.balance)}. Registrar mesmo assim (a conta fica negativa)?`, confirmLabel: 'Registrar' });
          if (!ok) return;
        }
        const { changes, rescue, fullyPaid } = payObligation(store.state, {
          obligationId: id, profileId: pid, amount, accountId: v.accountId || null, date: v.date || store.today, settle: Boolean(v.settle),
        }, { today: store.today, btcPrice: store.btcPrice() });
        await store.commit(changes);
        close();
        haptic([18, 40, 18]);
        const extra = rescue.minutes > 0 ? ` <b class="c-cyan">+${lifeTime(rescue.minutes)}</b> de vida resgatadas.` : '';
        toast(`${fullyPaid ? 'Conta quitada!' : 'Pagamento registrado.'}${extra}`, { tone: 'cyan', iconName: rescue.minutes > 0 ? 'hourglass' : 'check', timeout: 5200 });
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
      ${accountSelect('accountId', accounts, selected)}
      <div class="tiny" id="acc-hint"></div>
      <label class="field"><span>Categoria</span><select class="input" name="category"></select></label>
      ${textField('note', 'Descrição (opcional)', '', { placeholder: 'Ex.: mercado, uber, bico' })}
      ${dateField('date', 'Data', store.today, { hint: 'Data futura = agendado (entra na Onda de Liquidez).' })}
      <div id="inst-box" hidden>${numField('installments', 'Parcelas (cartão com garantia)', 1, { step: 1, hint: 'Parcelado trava parte da garantia até quitar.' })}</div>
      <button class="btn primary block" type="submit">Lançar</button>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      bindSegments(form);
      const sync = () => {
        const v = formData(form);
        const acc = accounts.find((a) => a.id === v.accountId);
        const cats = v.direction === 'in' ? CATEGORIES_IN : CATEGORIES_OUT;
        const sel = form.category;
        if (sel.dataset.dir !== v.direction) {
          sel.innerHTML = cats.map((c) => `<option>${c}</option>`).join('');
          sel.dataset.dir = v.direction;
        }
        const hint = {
          checking_cash: 'Mexe no caixa real de hoje.',
          benefit_card: 'Saldo restrito: não mexe no caixa real.',
          credit_card: v.direction === 'out' ? 'Compra no crédito: não mexe no caixa hoje, mas aumenta a dívida do cartão.' : 'Estorno no cartão.',
          collateralized_yield_crypto: v.direction === 'out' ? 'Gasto no cartão com garantia: gera cashback em sats.' : 'Depósito na garantia (rende CDI em BTC).',
        }[acc?.type] || '';
        el.querySelector('#acc-hint').textContent = hint;
        el.querySelector('#inst-box').hidden = !(acc?.type === 'collateralized_yield_crypto' && v.direction === 'out');
      };
      form.addEventListener('change', sync);
      sync();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = formData(form);
        const amount = parseMoney(v.amount);
        if (amount <= 0) { toast('Informe o valor.', { tone: 'magenta' }); return; }
        const { changes, entry } = addLedgerEntry(store.state, {
          profileId: pid, direction: v.direction, amount, accountId: v.accountId, category: v.category, note: v.note.trim(),
          date: v.date || store.today, installments: num(v.installments, 1),
        }, { today: store.today, btcPrice: store.btcPrice() });
        await store.commit(changes);
        close();
        haptic();
        toast(entry.status === 'scheduled' ? `Agendado para ${dateHuman(entry.date)}.` : 'Lançado.', { tone: 'cyan' });
      };
    },
  });
}

export async function removeEntry(id) {
  if (!await confirmSheet({ title: 'Desfazer lançamento?', text: 'O valor volta para a conta de origem.', confirmLabel: 'Desfazer' })) return;
  await store.commit(removeLedgerEntry(store.state, id));
  toast('Lançamento desfeito.');
}

// ------------------------------------------------------------ Contas

export function openAccountWizard(existingId = null) {
  const ex = existingId ? store.state.accounts.find((a) => a.id === existingId) : null;
  const type = ex?.type || 'checking_cash';
  openSheet({
    title: ex ? `Editar ${ex.name}` : 'Nova conta ou cartão',
    body: `<form novalidate>
      <label class="field"><span>Tipo</span><select class="input" name="type"${ex ? ' disabled' : ''}>
        ${Object.entries(ACCOUNT_TYPES).map(([k, t]) => `<option value="${k}"${k === type ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>
      ${textField('name', 'Nome', ex?.name || '', { required: true, placeholder: 'Ex.: Nubank, Caju, Bipa' })}
      <div data-t="checking_cash benefit_card">${moneyField('balance', 'Saldo atual', ex?.balance ?? '', { big: true })}</div>
      <div data-t="credit_card" class="stack">
        <div class="grid-2">${moneyField('limitTotal', 'Limite total', ex?.limitTotal ?? '')}${moneyField('limitAvailable', 'Disponível', ex?.limitAvailable ?? '')}</div>
        <div class="grid-2">${numField('closingDay', 'Fechamento (dia)', ex?.closingDay ?? '', { step: 1 })}${numField('dueDay', 'Vencimento (dia)', ex?.dueDay ?? '', { step: 1 })}</div>
        ${checkField('limitShrinking', 'O banco está cortando meu limite', ex?.limitShrinking)}
        <p class="tiny">A dívida do cartão entra pelo botão "+ Cartão" no Campo de Batalha.</p>
      </div>
      <div data-t="collateralized_yield_crypto" class="stack">
        <div class="grid-2">${moneyField('collateralTotal', 'Garantia total depositada', ex?.collateralTotal ?? '')}${moneyField('lockedInstallments', 'Travado em parcelas', ex?.lockedInstallments ?? '')}</div>
        <div class="grid-2">${numField('cdiPercent', '% do CDI', ex?.yieldConfig?.cdiPercent ?? 100)}${numField('cashbackPercent', 'Cashback (%)', ex?.yieldConfig?.cashbackPercent ?? 0.5)}</div>
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
        const t = ex?.type || v.type;
        if (!v.name.trim()) { toast('Dê um nome à conta.', { tone: 'magenta' }); return; }
        const acc = normalizeAccount({
          ...(ex || { id: uid('acc'), profileId: store.pid }), type: t, name: v.name.trim(),
          balance: parseMoney(v.balance), limitTotal: parseMoney(v.limitTotal),
          limitAvailable: v.limitAvailable === '' ? parseMoney(v.limitTotal) : parseMoney(v.limitAvailable),
          closingDay: num(v.closingDay) || null, dueDay: num(v.dueDay) || null, limitShrinking: Boolean(v.limitShrinking),
          collateralTotal: parseMoney(v.collateralTotal), lockedInstallments: parseMoney(v.lockedInstallments),
          yieldConfig: { cdiPercent: num(v.cdiPercent, 100), cashbackPercent: num(v.cashbackPercent, 0.5), payoutAsset: 'BTC' },
        });
        if (t === 'credit_card' && ex && ex.limitTotal !== acc.limitTotal) {
          acc.limitHistory = [...(ex.limitHistory || []), { date: store.today, limitTotal: acc.limitTotal }];
        }
        await store.commit({ accounts: [acc] });
        close();
        toast('Conta salva.', { tone: 'cyan' });
      };
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (await confirmSheet({ title: 'Excluir conta?', text: 'Os lançamentos ficam no histórico, mas a conta sai do deck.', confirmLabel: 'Excluir', danger: true })) {
          await store.commit({ removeAccounts: [ex.id] });
          toast('Conta excluída.');
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
        await store.commit(changes, { render: false });
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
        await store.commit(changes, { render: false });
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
    toast('Trava de Soberania fechada: resolva a Linha de Frente e a Linha d\'Água primeiro.', { tone: 'magenta' });
    return;
  }
  const accounts = store.state.accounts.filter((a) => a.profileId === store.pid && isRealLiquidity(a));
  openSheet({
    title: 'Registrar aporte em BTC',
    body: `<form novalidate>
      <p class="small">Excedente real disponível: <b class="c-cyan">${brl(d.eras.lock.excess)}</b> (caixa − Linha d'Água − micro-escudo).</p>
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
        await store.commit(changes);
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
        await store.commit({ profiles: [{ ...profile, accumulatedSats: Math.max(0, Math.floor(num(form.sats.value))) }] });
        close();
        toast('Placar atualizado.', { tone: 'cyan' });
      };
    },
  });
}

export { moneyToMinutes };
