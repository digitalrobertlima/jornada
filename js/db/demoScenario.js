// Cenário Realista de Teste — datas relativas a hoje, valores plausíveis.
// Aluguel dividido, cartão com garantia travada (modelo Bipa), benefício restrito
// (modelo Caju), cartão com corte de limite e boleto comercial com risco de protesto.

import { addDays, addMonths } from '../core/dates.js';
import { encodeBankBoleto } from '../parsers/boletoParser.js';
import { normalizeState } from '../core/model.js';

export function buildDemoScenario(today) {
  const d = (n) => addDays(today, n);
  const boleto = encodeBankBoleto({ bankCode: '237', dueDate: d(3), amount: 600, freeField: '3381286000000000300000004' });

  const raw = {
    household: { name: 'Casa Demonstração' },
    profiles: [
      {
        id: 'prof_01', name: 'Rafa', hue: 190,
        monthlyNetIncome: 3200, monthlyWorkHours: 176, monthlyCommuteHours: 44,
        currentEra: 1, rescuedLifeMinutes: 960, accumulatedSats: 24300, shieldTarget: 500,
        rescueLog: [
          { id: 'rsc_demo_1', date: d(-20), label: 'Fornecedor gráfica', amount: 210, minutes: 866.25, parts: [{ kind: 'protest', label: 'Taxa de cartório evitada', amount: 210 }] },
          { id: 'rsc_demo_2', date: d(-9), label: 'Conta de luz', amount: 22.75, minutes: 93.84, parts: [{ kind: 'fine', label: 'Multa por atraso evitada', amount: 22.75 }] },
        ],
        baselines: { battlefield: 6950 },
      },
      {
        id: 'prof_02', name: 'Duda', hue: 320,
        monthlyNetIncome: 2600, monthlyWorkHours: 180, monthlyCommuteHours: 30,
        currentEra: 1, rescuedLifeMinutes: 0, accumulatedSats: 0, shieldTarget: 500,
      },
    ],
    accounts: [
      { id: 'acc_bank_01', profileId: 'prof_01', name: 'Conta Corrente', type: 'checking_cash', balance: 1180 },
      {
        id: 'acc_bipa_01', profileId: 'prof_01', name: 'Cartão Bipa', type: 'collateralized_yield_crypto',
        collateralTotal: 7000, lockedInstallments: 6000,
        yieldConfig: { cdiPercent: 100, cashbackPercent: 0.5, payoutAsset: 'BTC' },
        satsFromYield: 18450, satsFromCashback: 3120, yieldAccruedUntil: d(-1),
      },
      { id: 'acc_caju_01', profileId: 'prof_01', name: 'Caju Benefícios', type: 'benefit_card', balance: 320 },
      {
        id: 'acc_cc_01', profileId: 'prof_01', name: 'Cartão Crédito', type: 'credit_card',
        limitTotal: 4000, limitAvailable: 120, limitShrinking: true, closingDay: 12, dueDay: 19,
        limitHistory: [{ date: d(-60), limitTotal: 6000 }, { date: d(-25), limitTotal: 4000 }],
      },
      { id: 'acc_bank_02', profileId: 'prof_02', name: 'Conta Duda', type: 'checking_cash', balance: 640 },
    ],
    obligations: [
      {
        id: 'obl_rent_01', profileId: 'prof_01', type: 'vital_fixed', vitalKind: 'moradia', bucket: 'casa',
        beneficiary: 'Aluguel Casa', totalAmount: 2500, isShared: true, shareMode: 'equal',
        dueDate: d(6), recurrence: 'monthly', rules: { finePercent: 10, dailyInterestPercent: 0.033 },
      },
      {
        id: 'obl_boleto_01', profileId: 'prof_02', type: 'boleto', bucket: 'negocio',
        beneficiary: 'Fornecedor Pet Shop', barcode: boleto.line, principalAmount: 600, balance: 600, dueDate: d(3),
        rules: { finePercent: 2, dailyInterestPercent: 0.033, canProtest: true, protestDeadline: d(8), estimatedProtestFee: 210 },
      },
      {
        id: 'obl_luz_01', profileId: 'prof_01', type: 'vital_fixed', vitalKind: 'contas', bucket: 'casa',
        beneficiary: 'Conta de luz', totalAmount: 186.4, dueDate: d(10), recurrence: 'monthly', rules: { finePercent: 2, dailyInterestPercent: 0.033 },
      },
      {
        id: 'obl_moto_01', profileId: 'prof_01', type: 'vital_fixed', vitalKind: 'trabalho', bucket: 'pessoal',
        beneficiary: 'Aluguel da moto (trabalho)', totalAmount: 389, dueDate: d(12), recurrence: 'monthly',
      },
      {
        id: 'obl_transp_02', profileId: 'prof_02', type: 'vital_fixed', vitalKind: 'transporte', bucket: 'pessoal',
        beneficiary: 'Recarga transporte', totalAmount: 220, dueDate: d(4), recurrence: 'monthly',
      },
      {
        id: 'obl_tia_01', profileId: 'prof_01', type: 'personal_debt', bucket: 'familia',
        beneficiary: 'Tia Célia (empréstimo)', principalAmount: 300, balance: 300,
      },
      {
        id: 'obl_leo_01', profileId: 'prof_01', type: 'personal_debt', bucket: 'familia',
        beneficiary: 'Léo (rateio do churrasco)', principalAmount: 85, balance: 85,
      },
      {
        id: 'obl_irma_02', profileId: 'prof_02', type: 'personal_debt', bucket: 'familia',
        beneficiary: 'Irmã (Pix emprestado)', principalAmount: 150, balance: 150,
      },
      {
        id: 'obl_cc_01', profileId: 'prof_01', type: 'card_debt', bucket: 'pessoal', accountId: 'acc_cc_01',
        beneficiary: 'Fatura Cartão Crédito', principalAmount: 3420, balance: 3880, monthlyInterestPercent: 14.5,
        dueDate: addMonths(today, 0, 19) >= today ? addMonths(today, 0, 19) : addMonths(today, 1, 19),
      },
      {
        id: 'obl_emp_01', profileId: 'prof_01', type: 'financing', bucket: 'pessoal',
        beneficiary: 'Empréstimo pessoal (banco)', principalAmount: 2800, balance: 2400, monthlyInterestPercent: 6.9,
        installmentAmount: 310, installmentsLeft: 10, dueDate: d(16),
      },
      {
        id: 'obl_old_01', profileId: 'prof_01', type: 'legacy_debt', bucket: 'pessoal',
        beneficiary: 'Cartão antigo (2021)', principalAmount: 1900, balance: 11800, dueDate: '2021-08-10', settlementDiscountPercent: 85,
      },
      {
        id: 'obl_old_02', profileId: 'prof_01', type: 'legacy_debt', bucket: 'pessoal',
        beneficiary: 'Cheque especial (2022)', principalAmount: 900, balance: 4300, dueDate: '2022-03-05', settlementDiscountPercent: 80,
      },
    ],
    ledger: [
      { id: 'tx_d01', profileId: 'prof_01', date: d(-12), direction: 'in', amount: 1600, accountId: 'acc_bank_01', impactCashToday: true, category: 'salário', note: 'Quinzena' },
      { id: 'tx_d02', profileId: 'prof_01', date: d(-11), direction: 'out', amount: 310, accountId: 'acc_bank_01', impactCashToday: true, category: 'pagamento', note: 'Parcela empréstimo' },
      { id: 'tx_d03', profileId: 'prof_01', date: d(-9), direction: 'out', amount: 186.4, accountId: 'acc_bank_01', impactCashToday: true, category: 'pagamento', note: 'Conta de luz (mês anterior)' },
      { id: 'tx_d04', profileId: 'prof_01', date: d(-7), direction: 'out', amount: 142.3, accountId: 'acc_caju_01', impactCashToday: false, category: 'mercado', note: 'Mercado no Caju' },
      { id: 'tx_d05', profileId: 'prof_01', date: d(-6), direction: 'out', amount: 89.9, accountId: 'acc_cc_01', impactCashToday: false, category: 'farmácia', note: 'Farmácia no crédito' },
      { id: 'tx_d06', profileId: 'prof_01', date: d(-5), direction: 'out', amount: 58, accountId: 'acc_bank_01', impactCashToday: true, category: 'transporte', note: 'Combustível' },
      { id: 'tx_d07', profileId: 'prof_01', date: d(-3), direction: 'out', amount: 64.5, accountId: 'acc_bipa_01', impactCashToday: false, category: 'mercado', note: 'Padaria no Bipa (cashback BTC)' },
      { id: 'tx_d08', profileId: 'prof_01', date: d(-2), direction: 'out', amount: 75.4, accountId: 'acc_bank_01', impactCashToday: true, category: 'casa', note: 'Gás' },
      { id: 'tx_d09', profileId: 'prof_01', date: d(-1), direction: 'in', amount: 120, accountId: 'acc_bank_01', impactCashToday: true, category: 'extra', note: 'Bico de entrega' },
      { id: 'tx_d10', profileId: 'prof_01', date: d(5), direction: 'in', amount: 840, accountId: 'acc_bank_01', impactCashToday: true, category: 'adiantamento', note: 'Adiantamento', status: 'scheduled' },
      { id: 'tx_d11', profileId: 'prof_01', date: d(13), direction: 'in', amount: 1600, accountId: 'acc_bank_01', impactCashToday: true, category: 'salário', note: 'Quinzena', status: 'scheduled' },
      { id: 'tx_d12', profileId: 'prof_02', date: d(-10), direction: 'in', amount: 1300, accountId: 'acc_bank_02', impactCashToday: true, category: 'salário', note: 'Quinzena' },
      { id: 'tx_d13', profileId: 'prof_02', date: d(-4), direction: 'out', amount: 210, accountId: 'acc_bank_02', impactCashToday: true, category: 'mercado', note: 'Feira e mercado' },
      { id: 'tx_d14', profileId: 'prof_02', date: d(9), direction: 'in', amount: 1300, accountId: 'acc_bank_02', impactCashToday: true, category: 'salário', note: 'Quinzena', status: 'scheduled' },
    ],
  };
  return normalizeState(raw);
}
