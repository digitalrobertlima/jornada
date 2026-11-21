// Guia Financeiro: transforma a situação da pessoa em PRÓXIMOS PASSOS concretos, em ordem.
// Cada passo diz o que fazer, por que (uma frase), e traz o botão que já faz.
//
// Base: escassez reduz a "largura de banda" mental (Mullainathan & Shafir) → uma decisão por vez,
// linguagem simples e o próximo passo pronto; fechar dívidas pequenas mantém a motivação
// (Gal & McShane, 2012) → vitórias rápidas quando sobra dinheiro; proximidade da meta acelera
// o esforço (efeito gradiente de meta) → destacar o que está quase quitado.

import { brl, lifeTime, dateHuman } from '../core/format.js';
import { addDays } from '../core/dates.js';
import { num, round2 } from '../core/util.js';
import { planDistribution, pendingForecasts, essentialsCoverage, scheduledLiquid } from './forecast.js';

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

  // 3) Falta dinheiro para as contas essenciais dos próximos 15 dias — contando o que vai entrar antes de cada vencimento
  const deficit = round2(Math.max(0, wl.floor - cash));
  const cov = deficit > 0 && d.today ? essentialsCoverage(state, pid, d.today, wl, cash) : { shortfall: deficit, used: [] };
  if (deficit > 0 && cov.shortfall <= 0) {
    push({
      id: 'waterline-covered', tone: 'info',
      title: `As contas essenciais (${brl(wl.floor)}) fecham com o que vai entrar`,
      why: `Hoje você tem ${brl(cash)}. Com ${cov.used.map((e) => `${e.note} (${brl(e.amount)}, ${dateHuman(e.date)})`).join(' e ')}, dá para pagar ${wl.items.map((i) => i.ob.beneficiary).join(', ')} no vencimento. Não use esse dinheiro em outra coisa antes, e toque em "Caiu!" quando entrar.`,
      actions: [{ label: 'Ver como distribuir', act: 'forecast-plan', primary: true }],
    });
  } else if (deficit > 0) {
    const biggest = [...wl.items].sort((a, b) => b.dueNow - a.dueNow)[0];
    const loans = tri.battlefield.filter((x) => x.ob.receivedAmount && num(x.ob.loanTotal) > num(x.ob.receivedAmount));
    const loanCost = loans.length ? Math.round(((num(loans[0].ob.loanTotal) - num(loans[0].ob.receivedAmount)) / num(loans[0].ob.receivedAmount)) * 100) : null;
    const counted = cov.used.length ? ' mesmo contando o que vai entrar' : '';
    push({
      id: 'waterline', tone: 'warn',
      title: `Faltam ${brl(cov.shortfall)} para as contas essenciais dos próximos 15 dias${counted}`,
      why: `Melhores saídas, nesta ordem: 1) segure gastos que não são essenciais; 2) peça para mudar a data${biggest ? ` de ${biggest.ob.beneficiary}` : ''}; 3) renda extra rápida (bico, venda); 4) empréstimo só em último caso${loanCost ? ` — o último custou ${loanCost}% a mais` : ''}. Não use o dinheiro dessas contas para pagar outras dívidas.`,
      amount: cov.shortfall,
      actions: [
        ...(biggest ? [{ label: `Roteiro: adiar ${biggest.ob.beneficiary}`, act: 'script', id: biggest.id, primary: true }] : []),
        { label: 'Entrou dinheiro', act: 'caiu' },
      ],
    });
  }

  // 3a) Entrada agendada que parece fixa (salário, vale) mas não está marcada "todo mês": a projeção some com ela depois
  const recurring = d.today ? scheduledLiquid(state, pid).filter((e) => e.direction === 'in' && e.date >= d.today
    && /sal[aá]rio|vale|benef|adiantamento|quinzena|pens[aã]o|aposentad/i.test(`${e.note} ${e.category}`)) : [];
  if (recurring.length) {
    const e = recurring[0];
    push({
      id: `recurring-${e.id}`, tone: 'info',
      title: `${e.note || e.category} (${brl(e.amount)}) cai todo mês?`,
      why: `Está agendado só para ${dateHuman(e.date)}. Se ele se repete, marque como "todo mês": o plano e o "quando vou respirar?" passam a contar com ele nos próximos meses.`,
      actions: [{ label: 'Sim, cai todo mês', act: 'sched-monthly', id: e.id, primary: true }, { label: 'Ver lançamento', act: 'entry-open', id: e.id }],
    });
  }

  // 3b) Previsão de entradas: confirmar o que devia ter caído e avisar onde o dinheiro chega depois da conta
  const today = d.today;
  const pending = today ? pendingForecasts(state, pid) : [];
  for (const e of pending.filter((x) => x.date < today).slice(0, 1)) {
    push({
      id: `forecast-late-${e.id}`, tone: 'warn', title: `Era para entrar ${brl(e.amount)} (${e.note}) em ${dateHuman(e.date)}. Já caiu?`,
      why: 'Confirme quando cair para o app contar com esse dinheiro. Se atrasou, o plano de pagamento muda.',
      actions: [{ label: 'Abrir previsão', act: 'forecast-open', id: e.id, primary: true }],
    });
  }
  if (today && pending.length) {
    const plan = planDistribution(state, pid, today, tri, { reserveTarget: d.profile?.shieldTarget || 500 });
    // só contas que ainda VÃO vencer: as já atrasadas têm passo próprio ("atrasada há N dias")
    const gap = plan.gaps.filter((g) => g.date >= today && (g.essential || g.resolvedAt)).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (gap) {
      const when = gap.date === today ? 'vence hoje' : `vence ${dateHuman(gap.date)}`;
      push({
        id: `forecast-gap-${gap.id}`, tone: 'warn',
        title: `${gap.name} ${when}, mas o dinheiro ${gap.resolvedAt ? `só entra em ${dateHuman(gap.resolvedAt)}` : 'previsto não cobre'}`,
        why: gap.resolvedAt
          ? `O dinheiro para pagar ${brl(gap.amount)} só chega em ${dateHuman(gap.resolvedAt)}. Ligue antes do vencimento e peça para mudar a data para depois disso: é bem mais barato que atrasar.`
          : gap.missing > 0.004
            ? `Com o que está previsto, faltam ${brl(gap.missing)} para pagar ${brl(gap.amount)}. Combine uma nova data ou procure uma renda extra.`
            : 'Ligue antes do vencimento e combine uma nova data: é bem mais barato que atrasar.',
        actions: [{ label: 'Roteiro: mudar a data', act: 'script', id: gap.id, primary: true }, { label: 'Ver plano', act: 'forecast-plan' }],
      });
    } else {
      const next = pending.find((x) => x.date >= today && x.liquidity !== 'locked');
      if (next && next.date <= addDays(today, 7)) {
        push({
          id: 'forecast-plan', tone: 'info', title: `${next.note}: ${brl(next.amount)} entram ${next.date === today ? 'hoje' : dateHuman(next.date)}`,
          why: 'Já deixei pronto como distribuir: primeiro as contas essenciais, depois a reserva, depois as dívidas.',
          actions: [{ label: 'Ver como distribuir', act: 'forecast-plan', primary: true }],
        });
      }
    }
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

  // conta com nome de cofrinho cadastrada como conta Pix: está somando no "dinheiro livre"
  const pot = state.accounts.find((a) => a.profileId === pid && a.type === 'checking_cash' && /cofrinh|caixinh|poupan/i.test(a.name));
  if (pot && steps.length < 6) {
    push({
      id: `pot-type-${pot.id}`, tone: 'info', title: `${pot.name} está como conta Pix`,
      why: 'Se é um cofrinho ou caixinha, marque o tipo como Cofrinho: o saldo dele deixa de contar como dinheiro livre para as contas, e você usa "Mover saldo" quando precisar dele.',
      actions: [{ label: 'Mudar o tipo', act: 'account-edit', id: pot.id, primary: true }],
    });
  }

  if (!hasVital) {
    push({
      id: 'missing-vital', tone: 'info', title: 'Cadastre suas contas essenciais',
      why: 'Sem aluguel, luz e transporte cadastrados, o app não consegue proteger o essencial.',
      actions: [{ label: 'Cadastrar conta essencial', act: 'obligation-new', kind: 'vital', primary: true }],
    });
  }

  if (today && !pending.length && steps.length < 4) {
    push({
      id: 'forecast-start', tone: 'info', title: 'Cadastre o que vai entrar (salário, adiantamento, vale)',
      why: 'Com as entradas previstas, o app calcula como distribuir cada uma e avisa quando uma conta vence antes do dinheiro chegar.',
      actions: [{ label: 'Prever uma entrada', act: 'forecast-new', primary: !steps.length }],
    });
  }

  if (steps.every((s) => s.id === 'forecast-start')) {
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
