import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { addLedgerEntry, payObligation, realLiquidity } from '../js/engines/cashflow.js';
import { newAction, recordInverse, buildUndo } from '../js/engines/journal.js';
import { normalizeObligation } from '../js/core/model.js';
import { triage } from '../js/engines/triage.js';

const TODAY = '2026-11-19';

function apply(state, ch) {
  const s = structuredClone(state);
  for (const key of ['accounts', 'obligations', 'ledger', 'profiles']) {
    for (const rec of ch[key] || []) {
      const i = s[key].findIndex((r) => r.id === rec.id);
      if (i >= 0) s[key][i] = rec; else s[key].push(rec);
    }
  }
  const rm = { removeLedger: 'ledger', removeObligations: 'obligations', removeAccounts: 'accounts', removeProfiles: 'profiles' };
  for (const [k, key] of Object.entries(rm)) if (ch[k]) s[key] = s[key].filter((r) => !ch[k].includes(r.id));
  return s;
}

function commit(state, ch, action) {
  recordInverse(action, state, ch);
  return apply(state, ch);
}

test('desfazer "entrou dinheiro + pagou plano de saúde" devolve tudo, mesmo com ações depois', () => {
  let s = buildDemoScenario(TODAY);
  s.obligations.push(normalizeObligation({
    id: 'obl_saude', profileId: 'prof_01', type: 'vital_fixed', vitalKind: 'saude', beneficiary: 'Plano de saúde',
    totalAmount: 74, dueDate: '2026-11-21', recurrence: 'monthly', rules: { finePercent: 2 },
  }));
  const cash0 = realLiquidity(s, 'prof_01');
  const life0 = s.profiles[0].rescuedLifeMinutes;

  // ação 1: entrou 500 e pagou 74 do plano (duas gravações na mesma ação)
  const a1 = newAction('act1', 'Entrou dinheiro');
  const inc = addLedgerEntry(s, { profileId: 'prof_01', direction: 'in', amount: 500, accountId: 'acc_bank_01' }, { today: TODAY });
  s = commit(s, inc.changes, a1);
  const pay = payObligation(s, { obligationId: 'obl_saude', profileId: 'prof_01', amount: 74, accountId: 'acc_bank_01', date: TODAY }, { today: TODAY });
  s = commit(s, pay.changes, a1);
  assert.equal(realLiquidity(s, 'prof_01'), cash0 + 500 - 74);
  assert.ok(s.obligations.some((o) => o.beneficiary === 'Plano de saúde' && o.status === 'open' && o.dueDate === '2026-12-21'));

  // ação 2, depois: gasto de 30
  const a2 = newAction('act2', 'Lançamento');
  const out = addLedgerEntry(s, { profileId: 'prof_01', direction: 'out', amount: 30, accountId: 'acc_bank_01' }, { today: TODAY });
  s = commit(s, out.changes, a2);

  // desfaz a ação 1 inteira
  s = apply(s, buildUndo(a1, s));
  assert.equal(realLiquidity(s, 'prof_01'), cash0 - 30); // o gasto de 30 continua lá
  const saude = s.obligations.filter((o) => o.beneficiary === 'Plano de saúde');
  assert.equal(saude.length, 1); // mês seguinte criado pelo pagamento sumiu
  assert.equal(saude[0].status, 'open');
  assert.equal(saude[0].dueDate, '2026-11-21');
  assert.equal(s.profiles[0].rescuedLifeMinutes, life0);
  assert.ok(!s.ledger.some((e) => inc.changes.ledger.some((x) => x.id === e.id)));
  assert.ok(triage(s, 'prof_01', TODAY).frontline.some((i) => i.id === 'obl_saude'));
});

test('desfazer cadastro remove a dívida; desfazer exclusão traz de volta', () => {
  let s = buildDemoScenario(TODAY);
  const a = newAction('a', 'Excluir');
  s = commit(s, { removeObligations: ['obl_tia_01'] }, a);
  assert.ok(!s.obligations.some((o) => o.id === 'obl_tia_01'));
  s = apply(s, buildUndo(a, s));
  assert.equal(s.obligations.find((o) => o.id === 'obl_tia_01').balance, 300);
});

test('desfazer pagamento de parcela volta a contagem', () => {
  let s = buildDemoScenario(TODAY);
  s.obligations.push(normalizeObligation({ id: 'b', profileId: 'prof_01', type: 'personal_debt', beneficiary: 'Betina', balance: 225, installmentAmount: 75, installmentsTotal: 3, installmentsLeft: 3, dueDate: '2026-11-25' }));
  const a = newAction('p', 'Pagamento');
  const r = payObligation(s, { obligationId: 'b', profileId: 'prof_01', amount: 75, accountId: 'acc_bank_01', date: TODAY }, { today: TODAY });
  s = commit(s, r.changes, a);
  assert.equal(s.obligations.find((o) => o.id === 'b').installmentsLeft, 2);
  s = apply(s, buildUndo(a, s));
  const b = s.obligations.find((o) => o.id === 'b');
  assert.equal(b.installmentsLeft, 3);
  assert.equal(b.balance, 225);
  assert.equal(b.dueDate, '2026-11-25');
  assert.equal(realLiquidity(s, 'prof_01'), 1180);
});
