// Guia Financeiro: transforma a situação da pessoa em PRÓXIMOS PASSOS concretos, em ordem.
// Cada passo diz o que fazer, por que (uma frase), e traz o botão que já faz.
//
// Base: escassez reduz a "largura de banda" mental (Mullainathan & Shafir) → uma decisão por vez,
// linguagem simples e o próximo passo pronto; fechar dívidas pequenas mantém a motivação
// (Gal & McShane, 2012) → vitórias rápidas quando sobra dinheiro; proximidade da meta acelera
// o esforço (efeito gradiente de meta) → destacar o que está quase quitado.

import { brl, lifeTime, dateHuman } from '../core/format.js';
import { num, round2 } from '../core/util.js';

const life = (amount, rate) => (rate > 0 ? lifeTime((amount / rate) * 60) : '');
const plural = (n, s, p) => (n === 1 ? s : p);

/**
 * @param {object} d   resultado de store.derive()
 * @param {object} ctx { state, today }
 * @returns {Array<{id, tone, title, why, actions}>} tone: urgent | warn | win | info
 */
export function buildGuide(d, { state }) {
  const steps = [];
  const { tri, wl, cash, eras, rate, pid } = d;
  const push = (s) => steps.push(s);
  const all = [...tri.frontline, ...tri.battlefield];

  // 0) Sem dados: o guia ensina a começar
  const hasVital = state.obligations.some((o) => o.type === 'vital_fixed' && (o.profileId === pid || o.isShared));
  if (!all.length && !tri.quarantine.length) {
    push({
      id: 'start-vital', tone: 'info', title: 'Comece pelas contas essenciais',
      why: 'Aluguel, luz, água, transporte e alimentação vêm antes de qualquer dívida. Cadastre com a data de vencimento.',
      actions: [{ label: 'Cadastrar conta essencial', act: 'obligation-new', kind: 'vital', primary: true }],
    });
    push({
      id: 'start-debts', tone: 'info', title: 'Depois, liste tudo o que você deve',
      why: 'Boletos, cartões, empréstimos e dinheiro emprestado de pessoas. O app organiza a ordem certa de pagar.',
      actions: [{ label: 'Ver opções de cadastro', act: 'goto', tab: 'battle' }],
    });
    return steps;
  }

  // 1) Cartório: o dano mais caro e evitável
  for (const i of tri.frontline.filter((x) => x.isProtestable)) {
    const days = i.daysToProtest;
    const fee = num(i.ob.rules?.estimatedProtestFee);
    push({
      id: `protest-${i.id}`, tone: 'urgent',
      title: days === null ? `Negocie ${i.ob.beneficiary} antes do cartório`
        : days < 0 ? `${i.ob.beneficiary}: o prazo do cartório passou — ligue hoje`
          : `${i.ob.beneficiary}: cartório ${days === 0 ? 'HOJE' : `em ${days} ${plural(days, 'dia', 'dias')}`}`,
      why: `Protesto suja seu nome e custa cerca de ${brl(fee)} a mais${rate > 0 ? ` (${life(fee, rate)} do seu trabalho)` : ''}. Pagar ou negociar uma nova data agora é o que mais vale.`,
      amount: i.dueNow,
      actions: [
        { label: 'Roteiro da ligação', act: 'script', id: i.id, primary: true },
        { label: `Paguei ${brl(i.dueNow)}`, act: 'pay', id: i.id, protest: true },
      ],
    });
  }

  // 2) Contas essenciais atrasadas
  for (const i of tri.frontline.filter((x) => x.isVital && x.late > 0)) {
    push({
      id: `vital-late-${i.id}`, tone: 'urgent',
      title: `${i.ob.beneficiary} está atrasada há ${i.late} ${plural(i.late, 'dia', 'dias')}`,
      why: 'Conta essencial atrasada pode virar corte de serviço, multa ou despejo. Pague ou combine uma data hoje.',
      amount: i.dueNow,
      actions: [{ label: `Paguei ${brl(i.dueNow)}`, act: 'pay', id: i.id, primary: true }, { label: 'Roteiro para combinar data', act: 'script', id: i.id }],
    });
  }

  // 3) Falta dinheiro para as contas essenciais dos próximos 15 dias
  const deficit = round2(Math.max(0, wl.floor - cash));
  if (deficit > 0) {
    const biggest = [...wl.items].sort((a, b) => b.dueNow - a.dueNow)[0];
    const loans = tri.battlefield.filter((x) => x.ob.receivedAmount && num(x.ob.loanTotal) > num(x.ob.receivedAmount));
    const loanCost = loans.length ? Math.round(((num(loans[0].ob.loanTotal) - num(loans[0].ob.receivedAmount)) / num(loans[0].ob.receivedAmount)) * 100) : null;
    push({
      id: 'waterline', tone: 'warn',
      title: `Faltam ${brl(deficit)} para as contas essenciais dos próximos 15 dias`,
      why: `Melhores saídas, nesta ordem: 1) segure gastos que não são essenciais; 2) peça para mudar a data${biggest ? ` de ${biggest.ob.beneficiary}` : ''}; 3) renda extra rápida (bico, venda); 4) empréstimo só em último caso${loanCost ? ` — o último custou ${loanCost}% a mais` : ''}. Não use o dinheiro dessas contas para pagar outras dívidas.`,
      amount: deficit,
      actions: [
        ...(biggest ? [{ label: `Roteiro: adiar ${biggest.ob.beneficiary}`, act: 'script', id: biggest.id, primary: true }] : []),
        { label: 'Entrou dinheiro', act: 'caiu' },
      ],
    });
  }

  // 4) Cartão com corte de limite: o erro clássico
  for (const i of tri.battlefield.filter((x) => x.alerts.some((a) => a.kind === 'limitShrinking'))) {
    if (deficit > 0 || tri.frontline.length) {
      push({
        id: `shrink-${i.id}`, tone: 'warn', title: `Não pague o mínimo de ${i.ob.beneficiary} com dinheiro das contas essenciais`,
        why: 'O banco está cortando seu limite: o que você paga não volta como limite. Primeiro proteja casa, comida e transporte.',
        actions: [{ label: 'Roteiro de negociação', act: 'script', id: i.id, primary: true }],
      });
    }
  }

  // 5) Dívidas atrasadas que rodam juros
  for (const i of tri.battlefield.filter((x) => x.late > 0).slice(0, 2)) {
    push({
      id: `late-${i.id}`, tone: 'warn',
      title: `${i.ob.beneficiary}: atrasada há ${i.late} ${plural(i.late, 'dia', 'dias')}`,
      why: `Cada dia de atraso soma juros${i.bleed > 0 ? ` (≈ ${brl(i.bleed)} por mês${rate > 0 ? `, ${life(i.bleed, rate)} de trabalho` : ''})` : ''}. Se não der para pagar tudo, ligue e combine.`,
      amount: i.dueNow,
      actions: [{ label: `Pagar ${brl(i.dueNow)}`, act: 'pay', id: i.id, primary: true }, { label: 'Roteiro', act: 'script', id: i.id }],
    });
  }

  // 6) Juros altos: antecipar pode dar desconto
  for (const i of tri.battlefield.filter((x) => num(x.ob.monthlyInterestPercent) >= 8 && x.late === 0).slice(0, 1)) {
    push({
      id: `expensive-${i.id}`, tone: 'info',
      title: `${i.ob.beneficiary} cobra ${num(i.ob.monthlyInterestPercent).toLocaleString('pt-BR')}% ao mês`,
      why: 'Juro mensal alto é o que mais cresce. Quando sobrar dinheiro, peça o valor para quitar antecipado: o desconto costuma ser grande.',
      actions: [{ label: 'Quitei com desconto', act: 'pay', id: i.id, settle: true, primary: true }, { label: 'Roteiro', act: 'script', id: i.id }],
    });
  }

  // 7) Vence nos próximos 7 dias
  for (const i of all.filter((x) => x.late === 0 && x.daysToDue !== null && x.daysToDue <= 7 && !x.isProtestable).slice(0, 2)) {
    if (steps.some((s) => s.id.endsWith(i.id))) continue;
    push({
      id: `soon-${i.id}`, tone: 'info',
      title: `${i.ob.beneficiary} vence ${i.daysToDue === 0 ? 'hoje' : i.daysToDue === 1 ? 'amanhã' : dateHuman(i.ob.dueDate)}`,
      why: `${brl(i.dueNow)}${i.installment ? ` (${i.installment.label})` : ''}. Separe esse valor agora para não usar em outra coisa.`,
      amount: i.dueNow,
      actions: [{ label: `Paguei ${brl(i.dueNow)}`, act: 'pay', id: i.id, primary: true }],
    });
  }

  // 8) Sobrou dinheiro: reserva primeiro, depois vitória rápida
  const free = round2(cash - wl.floor);
  if (deficit === 0 && free > 0) {
    const target = eras.shield.target;
    if (free < target) {
      push({
        id: 'shield', tone: 'win', title: `Deixe ${brl(free)} parados como reserva`,
        why: `Uma reserva pequena (meta: ${brl(target)}) evita que um imprevisto vire empréstimo caro. Faltam ${brl(target - free)} para completar.`,
        actions: [{ label: 'Ver meu dinheiro', act: 'goto', tab: 'wallet' }],
      });
    }
    const spendable = round2(free - target);
    const quick = tri.battlefield.filter((x) => x.updated <= spendable).sort((a, b) => a.updated - b.updated)[0];
    if (quick) {
      push({
        id: `quick-${quick.id}`, tone: 'win', title: `Você pode quitar ${quick.ob.beneficiary} agora (${brl(quick.updated)})`,
        why: 'Fechar uma dívida inteira, mesmo pequena, é o que mais aumenta a chance de sair de todas — pesquisa com cerca de 6 mil pessoas endividadas.',
        actions: [{ label: `Quitei ${brl(quick.updated)}`, act: 'pay', id: quick.id, primary: true }],
      });
    }
  }

  // 9) Quase lá: última parcela
  for (const i of all.filter((x) => x.installment?.left === 1 && x.installment.total > 1).slice(0, 1)) {
    if (steps.some((s) => s.id.endsWith(i.id))) continue;
    push({
      id: `last-${i.id}`, tone: 'win', title: `Falta só 1 parcela de ${i.ob.beneficiary}`,
      why: `${brl(i.dueNow)} e essa torre fica toda azul. A reta final é onde mais vale manter o ritmo.`,
      actions: [{ label: `Paguei ${brl(i.dueNow)}`, act: 'pay', id: i.id, primary: true }],
    });
  }

  if (!hasVital) {
    push({
      id: 'missing-vital', tone: 'info', title: 'Cadastre suas contas essenciais',
      why: 'Sem aluguel, luz e transporte cadastrados, o app não consegue proteger o essencial.',
      actions: [{ label: 'Cadastrar conta essencial', act: 'obligation-new', kind: 'vital', primary: true }],
    });
  }

  if (!steps.length) {
    const next = tri.battlefield[0];
    push({
      id: 'steady', tone: 'win', title: next ? `Tudo em dia. Próximo alvo: ${next.ob.beneficiary}` : 'Tudo em dia',
      why: next ? `Quando entrar dinheiro, ${next.installment ? `pague a ${next.installment.label}` : `ataque esta dívida`} (${brl(next.dueNow)}).` : 'Continue registrando o que entra e o que sai.',
      actions: [{ label: 'Entrou dinheiro', act: 'caiu', debt: next?.id, primary: true }],
    });
  }
  return steps;
}

/** Quantas dívidas a pessoa já fechou (vitórias). Contas fixas mensais não contam. */
export function closedDebts(state, pid) {
  return state.obligations.filter((o) => o.status === 'paid' && o.type !== 'vital_fixed' && o.profileId === pid).length;
}
