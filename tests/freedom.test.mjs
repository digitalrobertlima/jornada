import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/core/model.js';
import { triage } from '../js/engines/triage.js';
import { projectFreedom, atHorizon } from '../js/engines/freedom.js';

const TODAY = '2026-11-21';
// cenário fictício: aluguel do mês já pago (o próximo vence em dezembro)
function scenario() {
  return normalizeState({
    household: {},
    profiles: [{ id: 'p', name: 'R', monthlyNetIncome: 1100 }],
    accounts: [
      { id: 'pix', profileId: 'p', name: 'Banco Azul - Conta', type: 'checking_cash', balance: 230 },
      { id: 'va', profileId: 'p', name: 'Vale Comida', type: 'benefit_card', balance: 0, lock: 'alimentacao' },
    ],
    obligations: [
      { id: 'alug', profileId: 'p', type: 'vital_fixed', vitalKind: 'moradia', beneficiary: 'Aluguel', totalAmount: 1200, balance: 1200, recurrence: 'monthly', dueDate: '2026-12-17' },
      { id: 'saude', profileId: 'p', type: 'vital_fixed', vitalKind: 'saude', beneficiary: 'Plano de saúde', totalAmount: 600, balance: 600, recurrence: 'monthly', dueDate: '2026-11-26' },
      { id: 'net', profileId: 'p', type: 'boleto', beneficiary: 'Internet Fibra', balance: 180, dueDate: '2026-11-10' },
      { id: 'pd', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa D', balance: 2400, dueDate: '2027-03-01' },
    ],
    ledger: [
      { id: 'f1', profileId: 'p', direction: 'in', amount: 500, accountId: 'pix', date: '2026-11-21', status: 'scheduled', forecast: true, liquidity: 'pix', note: 'Outra entrada' },
      { id: 'f2', profileId: 'p', direction: 'in', amount: 100, accountId: 'pix', date: '2026-11-23', status: 'scheduled', forecast: true, liquidity: 'pix', note: 'Extra' },
      { id: 'f3', profileId: 'p', direction: 'in', amount: 540, accountId: 'va', date: '2026-11-25', status: 'scheduled', forecast: true, liquidity: 'locked', repeat: 'monthly', note: 'VA' },
      { id: 'f4', profileId: 'p', direction: 'in', amount: 1100, accountId: 'pix', date: '2026-12-07', status: 'scheduled', forecast: true, liquidity: 'pix', repeat: 'monthly', note: 'Salário' },
      { id: 's1', profileId: 'p', direction: 'in', amount: 1400, accountId: 'pix', date: '2026-12-07', status: 'scheduled', note: 'Vale-transporte' },
    ],
  });
}

test('essencial entra no mês em que vence (aluguel de dezembro não pesa em novembro)', () => {
  const s = scenario();
  const tri = triage(s, 'p', TODAY);
  const proj = projectFreedom(s, 'p', TODAY, tri);
  const nov = atHorizon(proj, 1);
  assert.equal(nov.income, 600);
  assert.equal(nov.essentials, 600); // só o plano de saúde
  // 230 + 600 − 600 = 230 → a conta atrasada primeiro, o resto vira reserva
  assert.equal(nov.per.get('net').done, true);
  assert.equal(nov.per.get('alug').dueIn, false);
  assert.equal(nov.per.get('saude').done, true);
  assert.ok(Math.abs(nov.toDebts + nov.leftover - 230) < 0.01);
  // dezembro: salário + vale-transporte agendado na conta; aluguel e plano saem
  const dez = atHorizon(proj, 2);
  assert.equal(dez.income, 3100);
  assert.equal(dez.essentials, 600 + 1200 + 600);
  assert.equal(dez.per.get('alug').done, true);
});

test('atrasada vem antes de parcela; parcela só a partir do mês em que vence', () => {
  const st = scenario();
  st.obligations.push(
    { id: 'pa', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa A', balance: 160, installmentAmount: 80, installmentsLeft: 2, installmentsTotal: 2, dueDate: '2026-11-28' },
    { id: 'pc', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa C', balance: 1500, installmentAmount: 125, installmentsLeft: 12, installmentsTotal: 12, dueDate: '2026-12-05' },
  );
  const proj = projectFreedom(st, 'p', TODAY, triage(st, 'p', TODAY));
  const nov = atHorizon(proj, 1);
  assert.equal(nov.per.get('net').done, true, 'a conta atrasada é paga primeiro');
  assert.equal(nov.per.get('pc').paid, 0, 'parcela de dezembro não é paga em novembro');
  // 230 − 180 = 50 → parte da parcela da Pessoa A (vence 28/11)
  assert.ok(Math.abs(nov.per.get('pa').paid - 50) < 0.01);
});
