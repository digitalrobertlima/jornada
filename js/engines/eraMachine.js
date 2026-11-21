// Máquina das 4 Eras + Trava de Soberania Web3.
// Era I Blindagem → Era II Demolição → Era III Quebra de Correntes → Era IV Soberania.

import { brl } from '../core/format.js';
import { num, round2, clamp } from '../core/util.js';

export const ERAS = [
  { n: 1, key: 'blindagem', roman: 'I', name: 'Blindagem', goal: 'Nenhum boleto indo a protesto e micro-escudo de liquidez montado.' },
  { n: 2, key: 'demolicao', roman: 'II', name: 'Demolição', goal: 'Quitar as dívidas com pessoas e os cartões ativos, do menor saldo para o maior.' },
  { n: 3, key: 'correntes', roman: 'III', name: 'Quebra de Correntes', goal: 'Juntar reserva para quitar a Quarentena à vista, com superdesconto de 70% a 90%.' },
  { n: 4, key: 'soberania', roman: 'IV', name: 'Soberania Web3', goal: 'O fluxo liberado vira Satoshis rumo a 1.00 BTC em autocustódia.' },
];

export const SATS_MILESTONES = [100_000, 1_000_000, 10_000_000, 100_000_000];

export function satsProgress(sats) {
  return clamp(Math.log10(Math.max(0, num(sats)) + 1) / 8, 0, 1);
}

export function nextMilestone(sats) {
  return SATS_MILESTONES.find((m) => num(sats) < m) || null;
}

/**
 * @param {object} ctx { tri, wl, cash, shieldTarget, sats, hasYieldCard, baselines }
 */
export function evaluateEras(ctx) {
  const { tri, wl } = ctx;
  const cash = num(ctx.cash);
  const shieldTarget = num(ctx.shieldTarget, 500) || 500;
  const floor = num(wl.floor);
  const shieldCurrent = round2(clamp(cash - floor, 0, shieldTarget));

  const protestables = tri.frontline.filter((i) => i.isProtestable);
  const overdueVitals = tri.frontline.filter((i) => i.isVital && i.late > 0);
  const waterlineDeficit = round2(Math.max(0, floor - cash));

  const era1Checks = [
    { label: 'Nenhum boleto a caminho do cartório', ok: protestables.length === 0, detail: protestables.length ? `${protestables.length} em risco` : '' },
    { label: 'Contas vitais em dia', ok: overdueVitals.length === 0, detail: overdueVitals.length ? `${overdueVitals.length} atrasada(s)` : '' },
    { label: 'Contas essenciais dos próximos 15 dias cobertas', ok: waterlineDeficit === 0, detail: waterlineDeficit ? `faltam ${brl(waterlineDeficit)} hoje` : '' },
    { label: `Micro-escudo de R$ ${shieldTarget.toFixed(0)}`, ok: shieldCurrent >= shieldTarget - 0.01, detail: '' },
  ];
  const era1Progress = (
    (protestables.length === 0 ? 1 : 0) * 0.3
    + (overdueVitals.length === 0 ? 1 : 0) * 0.2
    + (floor > 0 ? clamp(cash / floor, 0, 1) : 1) * 0.25
    + (shieldCurrent / shieldTarget) * 0.25
  );

  const bfOpen = round2(tri.battlefield.reduce((s, i) => s + i.updated, 0));
  const bfBase = Math.max(num(ctx.baselines?.battlefield), bfOpen);
  const quickWins = tri.battlefield.filter((i) => i.quickWin).length;
  const cards = new Set(tri.battlefield.filter((i) => i.ob.type === 'card_debt').map((i) => i.ob.accountId || i.id)).size;
  const era2Checks = [
    { label: 'Dívidas com pessoas quitadas', ok: quickWins === 0, detail: quickWins ? `${quickWins} restante(s)` : '' },
    { label: 'Cartões ativos quitados', ok: cards === 0, detail: cards ? `${cards} restante(s)` : '' },
    { label: 'Campo de Batalha limpo', ok: bfOpen === 0, detail: '' },
    { label: 'Gastos do dia a dia no cartão com garantia + cashback em BTC', ok: Boolean(ctx.hasYieldCard), detail: 'opcional', soft: true },
  ];
  const era2Progress = bfOpen === 0 ? 1 : bfBase > 0 ? clamp(1 - bfOpen / bfBase, 0, 1) : 0;

  const qOpen = round2(tri.quarantine.reduce((s, i) => s + i.updated, 0));
  const settlementCost = round2(tri.quarantine.reduce((s, i) => s + i.updated * (1 - num(i.ob.settlementDiscountPercent, 80) / 100), 0));
  const reserve = round2(Math.max(0, cash - floor - shieldTarget));
  const era3Checks = [
    { label: 'Reserva tática para quitação à vista', ok: qOpen === 0 || reserve >= settlementCost, detail: settlementCost ? `meta ≈ ${settlementCost.toFixed(2)}` : '' },
    { label: 'Domo de Quarentena vazio', ok: qOpen === 0, detail: tri.quarantine.length ? `${tri.quarantine.length} selada(s)` : '' },
  ];
  const era3Progress = qOpen === 0 ? 1 : settlementCost > 0 ? clamp(reserve / settlementCost, 0, 0.99) : 0;

  const sats = num(ctx.sats);
  const next = nextMilestone(sats);
  const era4Checks = SATS_MILESTONES.map((m) => ({
    label: m >= 1e8 ? '100M sats = 1.00 BTC' : `${(m / 1e6 >= 1 ? `${m / 1e6}M` : `${m / 1e3}k`)} sats`,
    ok: sats >= m,
    detail: '',
  }));

  const done1 = era1Checks.every((c) => c.ok);
  const done2 = era2Checks.filter((c) => !c.soft).every((c) => c.ok);
  const done3 = era3Checks.every((c) => c.ok);
  const currentEra = !done1 ? 1 : !done2 ? 2 : !done3 ? 3 : 4;

  const eras = [
    { ...ERAS[0], done: done1, progress: clamp(era1Progress, 0, 1), checks: era1Checks },
    { ...ERAS[1], done: done2, progress: era2Progress, checks: era2Checks },
    { ...ERAS[2], done: done3, progress: era3Progress, checks: era3Checks },
    { ...ERAS[3], done: sats >= 1e8, progress: satsProgress(sats), checks: era4Checks, next },
  ];

  // Trava de Soberania: nenhuma alocação em cripto com Linha de Frente aberta ou Linha d'Água furada.
  const reasons = [];
  if (protestables.length) reasons.push(`${protestables.length} boleto(s) a caminho do cartório`);
  if (overdueVitals.length) reasons.push(`${overdueVitals.length} conta(s) vital(is) atrasada(s)`);
  if (waterlineDeficit > 0) reasons.push(`Faltam R$ ${waterlineDeficit.toFixed(2).replace('.', ',')} para as contas essenciais`);
  if (currentEra < 4) reasons.push(`Conclua a fase ${currentEra} — ${ERAS[currentEra - 1].name}`);
  const excess = round2(Math.max(0, cash - floor - shieldTarget));

  return {
    currentEra,
    eras,
    shield: { current: shieldCurrent, target: shieldTarget, gap: round2(Math.max(0, shieldTarget - shieldCurrent)) },
    waterlineDeficit,
    reserve,
    settlementCost,
    lock: { locked: reasons.length > 0, reasons, excess: reasons.length ? 0 : excess },
  };
}

/** Sugestão tática de fatiamento para o simulador "Caiu Dinheiro" (fração para o Alvo nº 1). */
export function suggestSplit(amount, { target, shieldGap, waterlineDeficit }) {
  const value = num(amount);
  if (value <= 0 || !target) return 0;
  const need = num(target.dueNow ?? target.updated);
  const urgent = target.zone === 'frontline' && target.urgencyDays <= 7;
  if (urgent) return clamp(need / value, 0, 1);
  // fora da urgência: primeiro garante a Linha d'Água e parte do escudo, depois ataca
  const protect = Math.min(value * 0.5, num(waterlineDeficit) + num(shieldGap));
  return clamp(Math.min(need, value - protect) / value, 0, 1);
}
