// Roteiros copiáveis de negociação (Cards de Missão).

import { brl, dateBR } from '../core/format.js';
import { addDays } from '../core/dates.js';

export function negotiationScript(item, { profileName, today }) {
  const ob = item.ob;
  const valor = brl(item.updated);
  const venc = ob.dueDate ? dateBR(ob.dueDate) : 'sem data';
  const proposta = dateBR(addDays(today, 5));
  const nome = profileName || '[seu nome]';

  if (item.isProtestable) {
    return `Olá, aqui é ${nome}. Estou ligando sobre o boleto de ${ob.beneficiary}, no valor de ${valor}, com vencimento em ${venc}.
Quero resolver isso ANTES de qualquer envio ao cartório.
1) Consigo pagar ${valor} até ${proposta}. Vocês podem segurar o envio a protesto até essa data?
2) Se não for possível à vista, posso dar uma entrada agora e o restante em parcelas sem juros abusivos?
3) Podem me mandar a confirmação por escrito (e-mail ou WhatsApp) e o novo boleto?
Obrigado(a). Anotei o nome de quem me atendeu e o protocolo.`;
  }
  if (ob.type === 'vital_fixed') {
    return `Oi! Aqui é ${nome}. Sobre ${ob.beneficiary} (${valor}, vence ${venc}):
quero manter tudo em dia e estou me organizando. Consigo pagar ${valor} até ${proposta}.
Se precisar, posso adiantar uma parte agora. Pode ser assim? Te mando o comprovante assim que pagar.`;
  }
  if (ob.type === 'card_debt') {
    return `Olá, aqui é ${nome}, titular do cartão. O saldo devedor está em ${valor}.
Não vou continuar no rotativo nem pagando só o mínimo.
Quero uma proposta de parcelamento do saldo total com juros menores, ou um desconto para quitação à vista.
Qual a taxa mensal e o CET dessa proposta? Pode me enviar por escrito antes de eu aceitar?`;
  }
  if (ob.type === 'personal_debt') {
    return `Oi! Lembrei dos ${valor} que você me emprestou. Muito obrigado(a) pela força.
Já separei para te devolver: consigo mandar até ${proposta}. Pode ser por Pix?`;
  }
  if (item.zone === 'quarantine') {
    const pct = ob.settlementDiscountPercent || 80;
    const oferta = brl(item.updated * (1 - pct / 100));
    return `Olá, aqui é ${nome}. Tenho uma dívida antiga com vocês (${ob.beneficiary}), hoje em ${valor}.
Tenho ${oferta} para QUITAÇÃO TOTAL à vista. Não tenho condições de pagar valor maior nem de parcelar.
Se aceitarem, preciso do boleto de quitação e da carta de quitação com baixa da negativação.`;
  }
  return `Olá, aqui é ${nome}. Sobre ${ob.beneficiary} (${valor}, vencimento ${venc}):
quero negociar. Consigo pagar até ${proposta}. Existe desconto para pagamento à vista ou parcelamento sem juros?
Podem me mandar a proposta por escrito?`;
}
