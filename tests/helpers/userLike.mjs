// Cenário fictício parecido com um caso real de aperto (nomes e valores inventados):
// pouco dinheiro hoje, entradas previstas, um vale pago em conta, contas essenciais,
// dívidas com pessoas parceladas, uma conta atrasada e fatura de cartão em dia.
import { normalizeState } from '../../js/core/model.js';

export const TODAY = '2026-11-21';
export function userState() {
  return normalizeState({
    household: {},
    profiles: [{ id: 'p', name: 'Ana', monthlyNetIncome: 1100, monthlyWorkHours: 176, shieldTarget: 500 }],
    accounts: [
      { id: 'pix', profileId: 'p', name: 'Banco Azul - Conta', type: 'checking_cash', balance: 230 },
      { id: 'cof', profileId: 'p', name: 'COFRINHO AZUL', type: 'checking_cash', balance: 0 },
      { id: 'va', profileId: 'p', name: 'Vale Comida', type: 'benefit_card', balance: 12, lock: 'alimentacao' },
      { id: 'roxo', profileId: 'p', name: 'Banco Roxo', type: 'credit_card', limitTotal: 600, limitAvailable: 300, closingDay: 10, dueDay: 17 },
      { id: 'mf', profileId: 'p', name: 'Mercado Facil', type: 'credit_card', limitTotal: 1000, limitAvailable: 860, closingDay: 10, dueDay: 17 },
      { id: 'garantia', profileId: 'p', name: 'Cartão Azul', type: 'collateralized_yield_crypto', collateralTotal: 100, lockedInstallments: 0 },
    ],
    obligations: [
      { id: 'net', profileId: 'p', type: 'boleto', beneficiary: 'Internet Fibra', balance: 180, dueDate: '2026-11-10' },
      { id: 'fat', profileId: 'p', type: 'card_debt', accountId: 'mf', beneficiary: 'Fatura Mercado Facil', balance: 140, dueDate: '2026-12-17' },
      { id: 'alug', profileId: 'p', type: 'vital_fixed', vitalKind: 'moradia', beneficiary: 'Aluguel', totalAmount: 1200, balance: 1200, recurrence: 'monthly', dueDate: '2026-12-17', zone: 'battlefield' },
      { id: 'saude', profileId: 'p', type: 'vital_fixed', vitalKind: 'saude', beneficiary: 'Plano de saúde', totalAmount: 600, balance: 600, recurrence: 'monthly', dueDate: '2026-11-26' },
      { id: 'pa', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa A', balance: 80, principalAmount: 160, totalAmount: 160, installmentAmount: 80, installmentsLeft: 1, installmentsTotal: 2, dueDate: '2026-12-19' },
      { id: 'pb', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa B', balance: 540, installmentAmount: 90, installmentsLeft: 6, installmentsTotal: 6, dueDate: '2026-12-05' },
      { id: 'pc', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa C', balance: 1500, installmentAmount: 125, installmentsLeft: 12, installmentsTotal: 12, dueDate: '2026-12-10' },
      { id: 'pd', profileId: 'p', type: 'personal_debt', beneficiary: 'Pessoa D', balance: 2400, installmentAmount: 120, installmentsLeft: 20, installmentsTotal: 20, dueDate: '2026-12-15' },
    ],
    ledger: [
      { id: 'f1', profileId: 'p', direction: 'in', amount: 500, accountId: 'pix', date: '2026-11-21', status: 'scheduled', forecast: true, liquidity: 'pix', kind: 'outro', note: 'Outra entrada' },
      { id: 'f2', profileId: 'p', direction: 'in', amount: 100, accountId: 'pix', date: '2026-11-23', status: 'scheduled', forecast: true, liquidity: 'pix', kind: 'extra', note: 'Extra / bico / venda' },
      { id: 'f3', profileId: 'p', direction: 'in', amount: 540, accountId: 'va', date: '2026-11-25', status: 'scheduled', forecast: true, liquidity: 'locked', kind: 'vale_alimentacao', repeat: 'monthly', note: 'Vale-alimentação' },
      { id: 'f4', profileId: 'p', direction: 'in', amount: 1100, accountId: 'pix', date: '2026-12-07', status: 'scheduled', forecast: true, liquidity: 'pix', kind: 'salario', repeat: 'monthly', note: 'Salário' },
      { id: 's1', profileId: 'p', direction: 'in', amount: 1400, accountId: 'pix', date: '2026-12-07', status: 'scheduled', category: 'benefício', note: 'Vale-transporte' },
      { id: 'p1', profileId: 'p', direction: 'out', amount: 50, accountId: 'pix', date: '2026-11-20', status: 'posted', category: 'outros', note: 'Empréstimo amigo', impactCashToday: true },
    ],
  });
}
