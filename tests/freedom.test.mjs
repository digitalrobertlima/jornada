import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState } from '../js/core/model.js';
import { triage } from '../js/engines/triage.js';
import { projectFreedom, atHorizon } from '../js/engines/freedom.js';

const TODAY = '2026-11-21';
// parecido com o caso real: aluguel do mês já pago (o próximo vence em dezembro)
function scenario() {
  return normalizeState({
    household: {},
    profiles: [{ id: 'p', name: 'R', monthlyNetIncome: 1095.32 }],
    accounts: [
      { id: 'pix', profileId: 'p', name: 'Bipa - Conta Corrente', type: 'checking_cash', balance: 229.40 },
      { id: 'caju', profileId: 'p', name: 'CAJU', type: 'benefit_card', balance: 0, lock: 'alimentacao' },
    ],
    obligations: [
      { id: 'alug', profileId: 'p', type: 'vital_fixed', vitalKind: 'moradia', beneficiary: 'Aluguel', totalAmount: 1250, balance: 1250, recurrence: 'monthly', dueDate: '2026-12-17' },
      { id: 'saude', profileId: 'p', type: 'vital_fixed', vitalKind: 'saude', beneficiary: 'Plano de saúde', totalAmount: 598, balance: 598, recurrence: 'monthly', dueDate: '2026-11-26' },
      { id: 'bmi', profileId: 'p', type: 'boleto', beneficiary: 'BMI TELECOM', balance: 193.74, dueDate: '2026-11-10' },
      { id: 'vovo', profileId: 'p', type: 'personal_debt', beneficiary: 'Vovô', balance: 2000, dueDate: '2027-03-01' },
    ],
    ledger: [
      { id: 'f1', profileId: 'p', direction: 'in', amount: 500, accountId: 'pix', date: '2026-11-21', status: 'scheduled', forecast: true, liquidity: 'pix', note: 'Outra entrada' },
      { id: 'f2', profileId: 'p', direction: 'in', amount: 100, accountId: 'pix', date: '2026-11-23', status: 'scheduled', forecast: true, liquidity: 'pix', note: 'Extra' },
      { id: 'f3', profileId: 'p', direction: 'in', amount: 540, accountId: 'caju', date: '2026-11-25', status: 'scheduled', forecast: true, liquidity: 'locked', repeat: 'monthly', note: 'VA' },
      { id: 'f4', profileId: 'p', direction: 'in', amount: 1095.32, accountId: 'pix', date: '2026-12-07', status: 'scheduled', forecast: true, liquidity: 'pix', repeat: 'monthly', note: 'Salário' },
      { id: 's1', profileId: 'p', direction: 'in', amount: 1382.50, accountId: 'pix', date: '2026-12-07', status: 'scheduled', note: 'Vale-transporte' },
    ],
  });
}

test('essencial entra no mês em que vence (aluguel de dezembro não pesa em novembro)', () => {
  const s = scenario();
  const tri = triage(s, 'p', TODAY);
  const proj = projectFreedom(s, 'p', TODAY, tri);
  const nov = atHorizon(proj, 1);
  assert.equal(nov.income, 600);
  assert.equal(nov.essentials, 598); // só o plano de saúde
  // 229,40 + 600 − 598 = 231,40 → BMI (atrasada) primeiro, o resto vira reserva
  assert.equal(nov.per.get('bmi').done, true);
  assert.equal(nov.per.get('alug').dueIn, false);
  assert.equal(nov.per.get('saude').done, true);
  assert.ok(Math.abs(nov.toDebts + nov.leftover - 231.40) < 0.01);
  // dezembro: salário + vale-transporte agendado na conta; aluguel e plano saem
  const dez = atHorizon(proj, 2);
  assert.equal(dez.income, 3077.82);
  assert.equal(dez.essentials, 598 + 1250 + 598);
  assert.equal(dez.per.get('alug').done, true);
});

test('atrasada vem antes de parcela; parcela só a partir do mês em que vence', () => {
  const st = scenario();
  st.obligations.push(
    { id: 'bet', profileId: 'p', type: 'personal_debt', beneficiary: 'Betina', balance: 150, installmentAmount: 75, installmentsLeft: 2, installmentsTotal: 2, dueDate: '2026-11-28' },
    { id: 'wil', profileId: 'p', type: 'personal_debt', beneficiary: 'Tio Wilson', balance: 1800, installmentAmount: 150, installmentsLeft: 12, installmentsTotal: 12, dueDate: '2026-12-05' },
  );
  const proj = projectFreedom(st, 'p', TODAY, triage(st, 'p', TODAY));
  const nov = atHorizon(proj, 1);
  assert.equal(nov.per.get('bmi').done, true, 'BMI atrasada é paga primeiro');
  assert.equal(nov.per.get('wil').paid, 0, 'parcela de dezembro não é paga em novembro');
  // 231,40 − 193,74 = 37,66 → parte da parcela da Betina (vence 28/11)
  assert.ok(Math.abs(nov.per.get('bet').paid - 37.66) < 0.01);
});
