import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoScenario } from '../js/db/demoScenario.js';
import { triage, shareAmount } from '../js/engines/triage.js';
import {
  realLiquidity, waterline, liquidityWave, householdCoverage, payObligation, addLedgerEntry, processScheduled, removeLedgerEntry,
} from '../js/engines/cashflow.js';
import { realHourlyRate, moneyToMinutes, rescueBreakdown, overdueAmount } from '../js/engines/lifeHours.js';
import { evaluateEras, suggestSplit } from '../js/engines/eraMachine.js';
import { accrueYield, satsScore, dailyCdiFactor } from '../js/engines/satsYield.js';
import { parseBoleto } from '../js/parsers/boletoParser.js';
import { normalizeAccount, normalizeObligation } from '../js/core/model.js';

const TODAY = '2026-11-19';

function apply(state, changes) {
  const s = structuredClone(state);
  for (const key of ['accounts', 'obligations', 'ledger', 'profiles']) {
    for (const rec of changes[key] || []) {
      const i = s[key].findIndex((r) => r.id === rec.id);
      if (i >= 0) s[key][i] = rec; else s[key].push(rec);
    }
  }
  if (changes.removeLedger) s.ledger = s.ledger.filter((e) => !changes.removeLedger.includes(e.id));
  return s;
}

test('hora de vida real: 3200 / (176 + 44) = 14,545/h', () => {
  const s = buildDemoScenario(TODAY);
  const rate = realHourlyRate(s.profiles[0]);
  assert.ok(Math.abs(rate - 14.5454) < 0.001);
  assert.equal(s.profiles[0].realHourlyRate, 14.55);
  assert.ok(Math.abs(moneyToMinutes(210, rate) - 866.25) < 0.01);
});

test('normalizador aceita nomes do SPEC original', () => {
  const bipa = normalizeAccount({ id: 'a', type: 'collateralized_yield_crypto', collateralTotal: 7000, lockedInstallments: 6000, availableLimit: 999 });
  assert.equal(bipa.limitAvailable, 1000); // invariante: total − travado
  assert.equal(bipa.isRealLiquidity, false);
  const rent = normalizeObligation({ id: 'o', profileId: 'prof_01', type: 'vital_fixed', totalAmount: 2500, isShared: true, profileShareAmount: 1250 });
  assert.equal(rent.shareMode, 'fixed');
  assert.equal(shareAmount(rent, 'prof_01', ['prof_01', 'prof_02']), 1250);
  assert.equal(shareAmount(rent, 'prof_02', ['prof_01', 'prof_02']), 1250);
});

test('triagem: zonas e Alvo nº 1 do perfil 1', () => {
  const s = buildDemoScenario(TODAY);
  const t = triage(s, 'prof_01', TODAY);
  assert.deepEqual(t.frontline.map((i) => i.id), ['obl_rent_01', 'obl_luz_01', 'obl_moto_01']);
  assert.equal(t.frontline[0].open, 1250); // cota do aluguel
  // vence hoje (cartão) → vence em 16 dias (empréstimo) → sem data: Quick Wins pelo menor saldo
  assert.deepEqual(t.battlefield.map((i) => i.id), ['obl_cc_01', 'obl_emp_01', 'obl_leo_01', 'obl_tia_01']);
  assert.deepEqual(t.quarantine.map((i) => i.id), ['obl_old_02', 'obl_old_01']);
  assert.equal(t.target.id, 'obl_rent_01');
  const card = t.battlefield.find((i) => i.id === 'obl_cc_01');
  assert.equal(card.alerts[0].kind, 'limitShrinking');
});

test('triagem: boleto protestável vai para a Linha de Frente do perfil 2', () => {
  const s = buildDemoScenario(TODAY);
  const t = triage(s, 'prof_02', TODAY);
  assert.equal(t.target.id, 'obl_boleto_01');
  assert.equal(t.target.daysToProtest, 8);
  assert.ok(t.frontline.some((i) => i.id === 'obl_rent_01'));
  const parsed = parseBoleto(t.target.ob.barcode, { reference: TODAY });
  assert.equal(parsed.isValid, true);
  assert.equal(parsed.amount, 600);
  assert.equal(parsed.dueDate, '2026-11-22');
});

test('invariante anti-paralisia: quarentena fora da Linha d\'Água', () => {
  const s = buildDemoScenario(TODAY);
  const t = triage(s, 'prof_01', TODAY);
  const wl = waterline(s, 'prof_01', TODAY, t);
  assert.equal(wl.floor, 1250 + 186.4 + 389);
  assert.ok(wl.items.every((i) => i.zone === 'frontline'));
});

test('invariante de liquidez real: só conta corrente', () => {
  const s = buildDemoScenario(TODAY);
  assert.equal(realLiquidity(s, 'prof_01'), 1180);
});

test('Onda de Liquidez: furo até a entrada agendada', () => {
  const s = buildDemoScenario(TODAY);
  const wave = liquidityWave(s, 'prof_01', TODAY);
  const today = wave.find((p) => p.offset === 0);
  assert.equal(today.balance, 1180);
  assert.equal(wave.find((p) => p.offset === 5).balance, 2020);
  assert.equal(wave.find((p) => p.offset === 13).balance, 3620);
  // reconstrução do passado: antes do bico de R$ 120 de ontem
  assert.equal(wave.find((p) => p.offset === -2).balance, 1060);
  assert.equal(wave.find((p) => p.offset === -13).balance, 89.8);
});

test('Casa: cobertura conjunta do aluguel', () => {
  const s = buildDemoScenario(TODAY);
  const cov = householdCoverage(s, TODAY);
  assert.equal(cov.rows.length, 1);
  assert.equal(cov.rows[0].shares.length, 2);
  assert.ok(cov.ratio > 0 && cov.ratio < 1);
});

test('Protesto Segurado: pagar antes do cartório resgata horas de vida', () => {
  const s = buildDemoScenario(TODAY);
  const { changes, rescue, fullyPaid } = payObligation(s, { obligationId: 'obl_boleto_01', profileId: 'prof_02', amount: 600, accountId: 'acc_bank_02', date: TODAY }, { today: TODAY });
  assert.equal(fullyPaid, true);
  assert.equal(rescue.parts.find((p) => p.kind === 'protest').amount, 210);
  assert.equal(rescue.parts.find((p) => p.kind === 'fine').amount, 12);
  assert.ok(rescue.minutes > 1000);
  const s2 = apply(s, changes);
  assert.equal(s2.accounts.find((a) => a.id === 'acc_bank_02').balance, 40);
  assert.equal(triage(s2, 'prof_02', TODAY).frontline.some((i) => i.id === 'obl_boleto_01'), false);
});

test('aluguel compartilhado: cada um paga a sua cota e o próximo mês nasce sozinho', () => {
  let s = buildDemoScenario(TODAY);
  let r = payObligation(s, { obligationId: 'obl_rent_01', profileId: 'prof_01', amount: 1250, accountId: 'acc_bank_01', date: TODAY }, { today: TODAY });
  assert.equal(r.fullyPaid, false);
  s = apply(s, r.changes);
  assert.equal(triage(s, 'prof_01', TODAY).frontline.some((i) => i.id === 'obl_rent_01'), false);
  assert.equal(triage(s, 'prof_02', TODAY).frontline.some((i) => i.id === 'obl_rent_01'), true);
  r = payObligation(s, { obligationId: 'obl_rent_01', profileId: 'prof_02', amount: 1250, date: TODAY }, { today: TODAY });
  assert.equal(r.fullyPaid, true);
  s = apply(s, r.changes);
  const next = s.obligations.find((o) => o.beneficiary === 'Aluguel Casa' && o.status === 'open');
  assert.equal(next.dueDate, '2026-12-25');
});

test('cartão com corte de limite: pagar não devolve limite', () => {
  const s = buildDemoScenario(TODAY);
  const { changes } = payObligation(s, { obligationId: 'obl_cc_01', profileId: 'prof_01', amount: 500, accountId: 'acc_bank_01', date: TODAY }, { today: TODAY });
  const s2 = apply(s, changes);
  const card = s2.accounts.find((a) => a.id === 'acc_cc_01');
  assert.equal(card.limitAvailable, 120);
  assert.equal(card.limitTotal, 3500);
  assert.equal(s2.obligations.find((o) => o.id === 'obl_cc_01').balance, 3380);
});

test('lançamentos: crédito não mexe no caixa; Bipa parcelado trava garantia; estorno', () => {
  const s = buildDemoScenario(TODAY);
  let r = addLedgerEntry(s, { profileId: 'prof_01', direction: 'out', amount: 100, accountId: 'acc_cc_01' }, { today: TODAY });
  assert.equal(r.entry.impactCashToday, false);
  let s2 = apply(s, r.changes);
  assert.equal(realLiquidity(s2, 'prof_01'), 1180);
  assert.equal(s2.obligations.find((o) => o.id === 'obl_cc_01').balance, 3980);

  r = addLedgerEntry(s, { profileId: 'prof_01', direction: 'out', amount: 300, accountId: 'acc_bipa_01', installments: 3 }, { today: TODAY, btcPrice: 400000 });
  s2 = apply(s, r.changes);
  const bipa = s2.accounts.find((a) => a.id === 'acc_bipa_01');
  assert.equal(bipa.lockedInstallments, 6300);
  assert.equal(bipa.limitAvailable, 700);
  assert.equal(bipa.satsFromCashback, 3120 + 375); // 0,5% de 300 = R$1,50 → 375 sats a R$400 mil
  const undo = removeLedgerEntry(s2, r.entry.id);
  const s3 = apply(s2, undo);
  assert.equal(s3.accounts.find((a) => a.id === 'acc_bipa_01').lockedInstallments, 6000);
});

test('agendados viram postados quando a data chega', () => {
  const s = buildDemoScenario(TODAY);
  const ch = processScheduled(s, '2026-11-24');
  const s2 = apply(s, ch);
  assert.equal(realLiquidity(s2, 'prof_01'), 1180 + 840);
});

test('Eras: perfil demo está na Era I com trava de soberania fechada', () => {
  const s = buildDemoScenario(TODAY);
  const tri = triage(s, 'prof_01', TODAY);
  const wl = waterline(s, 'prof_01', TODAY, tri);
  const ev = evaluateEras({ tri, wl, cash: 1180, shieldTarget: 500, sats: 45870, hasYieldCard: true, baselines: { battlefield: 6950 } });
  assert.equal(ev.currentEra, 1);
  assert.equal(ev.lock.locked, true);
  assert.equal(ev.lock.excess, 0);
  assert.ok(ev.lock.reasons.some((r) => r.includes("Linha d'Água")));
});

test('Eras: tudo limpo destrava a Era IV e libera o excedente real', () => {
  const tri = { frontline: [], battlefield: [], quarantine: [] };
  const ev = evaluateEras({ tri, wl: { floor: 0 }, cash: 2000, shieldTarget: 500, sats: 150000 });
  assert.equal(ev.currentEra, 4);
  assert.equal(ev.lock.locked, false);
  assert.equal(ev.lock.excess, 1500);
});

test('simulador: alvo urgente recebe o necessário', () => {
  const target = { zone: 'frontline', urgencyDays: 3, dueNow: 600, updated: 600 };
  assert.ok(Math.abs(suggestSplit(840, { target, shieldGap: 500, waterlineDeficit: 0 }) - 600 / 840) < 1e-9);
  const calm = { zone: 'battlefield', urgencyDays: 999, dueNow: 85, updated: 85 };
  assert.ok(Math.abs(suggestSplit(840, { target: calm, shieldGap: 500, waterlineDeficit: 0 }) - 85 / 840) < 1e-9);
});

test('rendimento CDI em sats (dias úteis)', () => {
  const daily = dailyCdiFactor(14.9, 100);
  assert.ok(Math.abs(Math.pow(1 + daily, 252) - 1.149) < 1e-9);
  const acc = { type: 'collateralized_yield_crypto', collateralTotal: 7000, yieldConfig: { cdiPercent: 100 }, yieldAccruedUntil: '2026-11-13', satsFromYield: 0 };
  const out = accrueYield(acc, { today: '2026-11-20', cdiAnnual: 14.9, btcPrice: 420000 });
  // 13/11 (sex) → 20/11 (sex): 5 dias úteis
  const expectedBRL = 7000 * (Math.pow(1 + daily, 5) - 1);
  assert.ok(Math.abs(out.yieldBRLTotal - Math.round(expectedBRL * 100) / 100) < 0.01);
  assert.equal(out.satsFromYield, Math.floor(expectedBRL / 420000 * 1e8));
  const s = buildDemoScenario(TODAY);
  assert.equal(satsScore(s, 'prof_01').total, 24300 + 18450 + 3120);
});

test('boleto em atraso: multa + juros diários', () => {
  assert.equal(overdueAmount(600, { finePercent: 2, dailyInterestPercent: 0.033 }, 10), 613.98);
  const r = rescueBreakdown({ rules: { canProtest: true, protestDeadline: '2026-11-27', estimatedProtestFee: 210, finePercent: 2 }, dueDate: '2026-11-22' }, 600, '2026-11-25', { fullPayment: true });
  assert.deepEqual(r.parts.map((p) => p.kind), ['protest']);
});

test('o exemplo do SPEC.md importa e passa pela triagem', async () => {
  const fs = await import('node:fs');
  const { Vault } = await import('../js/db/vault.js');
  const md = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const json = md.slice(md.indexOf('```json') + 7, md.indexOf('```', md.indexOf('```json') + 7));
  const { state } = Vault.parseBackup(json);
  assert.equal(state.profiles.length, 2);
  assert.equal(state.accounts.find((a) => a.id === 'acc_bipa_01').limitAvailable, 1000);
  const t = triage(state, 'prof_02', '2026-11-19');
  assert.equal(t.target.id, 'obl_boleto_01');
  const p = parseBoleto(t.target.ob.barcode, { reference: '2026-11-19' });
  assert.equal(p.isValid, true);
  assert.equal(p.dueDate, '2026-11-22');
  assert.equal(p.amount, 600);
  const t1 = triage(state, 'prof_01', '2026-11-19');
  assert.equal(t1.frontline.find((i) => i.id === 'obl_rent_01').open, 1250);
});

test('dívida com pessoa parcelada: 3x de R$ 75 (caso Betina)', () => {
  const s = buildDemoScenario(TODAY);
  s.obligations.push(normalizeObligation({
    id: 'obl_betina', profileId: 'prof_01', type: 'personal_debt', bucket: 'familia', beneficiary: 'Betina',
    balance: 225, principalAmount: 225, installmentAmount: 75, installmentsTotal: 3, installmentsLeft: 3, dueDate: '2026-11-25',
  }));
  let item = triage(s, 'prof_01', TODAY).battlefield.find((i) => i.id === 'obl_betina');
  assert.equal(item.dueNow, 75); // vence agora só a parcela
  assert.equal(item.updated, 225); // a Bola de Neve enxerga o saldo inteiro
  assert.equal(item.installment.label, 'parcela 1/3');

  let r = payObligation(s, { obligationId: 'obl_betina', profileId: 'prof_01', amount: 75, accountId: 'acc_bank_01', date: TODAY }, { today: TODAY });
  let s2 = apply(s, r.changes);
  let ob = s2.obligations.find((o) => o.id === 'obl_betina');
  assert.equal(ob.balance, 150);
  assert.equal(ob.installmentsLeft, 2);
  assert.equal(ob.dueDate, '2026-12-25');
  item = triage(s2, 'prof_01', TODAY).battlefield.find((i) => i.id === 'obl_betina');
  assert.equal(item.installment.label, 'parcela 2/3');

  // duas parcelas de uma vez quitam tudo
  r = payObligation(s2, { obligationId: 'obl_betina', profileId: 'prof_01', amount: 150, date: TODAY }, { today: TODAY });
  assert.equal(r.fullyPaid, true);
  ob = apply(s2, r.changes).obligations.find((o) => o.id === 'obl_betina');
  assert.equal(ob.status, 'paid');
  assert.equal(ob.installmentsLeft, 0);
});

test('parcelamento: total menor que restantes é corrigido e sem valor de parcela não é parcelado', () => {
  const a = normalizeObligation({ id: 'x', type: 'boleto', balance: 300, installmentAmount: 100, installmentsLeft: 3, installmentsTotal: 2 });
  assert.equal(a.installmentsTotal, 3);
  const b = normalizeObligation({ id: 'y', type: 'boleto', balance: 300, installmentsLeft: 3 });
  assert.equal(b.installmentsLeft, null);
});

test('carnê protestável: cada parcela paga em dia segura o cartório e o prazo avança', () => {
  const s = buildDemoScenario(TODAY);
  s.obligations.push(normalizeObligation({
    id: 'obl_carne', profileId: 'prof_01', type: 'boleto', beneficiary: 'Loja (carnê)', balance: 300, principalAmount: 300,
    installmentAmount: 100, installmentsTotal: 3, installmentsLeft: 3, dueDate: '2026-11-25',
    rules: { canProtest: true, protestDeadline: '2026-11-30', estimatedProtestFee: 210, finePercent: 2 },
  }));
  const item = triage(s, 'prof_01', TODAY).frontline.find((i) => i.id === 'obl_carne');
  assert.equal(item.dueNow, 100);
  let r = payObligation(s, { obligationId: 'obl_carne', profileId: 'prof_01', amount: 100, date: TODAY }, { today: TODAY });
  assert.equal(r.rescue.parts.find((x) => x.kind === 'protest').amount, 210);
  const s2 = apply(s, r.changes);
  const ob = s2.obligations.find((o) => o.id === 'obl_carne');
  assert.equal(ob.rules.protestDeadline, '2026-12-30');
  assert.equal(ob.protestRescued, false); // a próxima parcela ainda pode ser segurada
  r = payObligation(s2, { obligationId: 'obl_carne', profileId: 'prof_01', amount: 100, date: '2026-12-20' }, { today: '2026-12-20' });
  assert.ok(r.rescue.parts.some((x) => x.kind === 'protest'));
});
