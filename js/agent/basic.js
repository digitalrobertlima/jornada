// Modo básico: entende frases simples sem IA (funciona em qualquer celular, na hora).
// Traduz a frase para UMA ferramenta do catálogo; a prévia e a confirmação são as mesmas da IA.

import { norm, parseMoneyBR, parseDateBR } from '../core/text.js';

const FILLER = /\b(eu|o|a|os|as|um|uma|de|do|da|dos|das|no|na|nos|nas|pra|pro|para|com|que|ja|hoje|ontem|amanha|reais|real|r|conto|contos|pila|meu|minha|meus|minhas|agora|aqui|ai|la|ta|to|tô|foi|vai|e|em|por|valor|dia \d{1,2}|\d+(?:[.,]\d+)*(?: ?mil)?)\b/g;

function rest(text, verb) {
  return norm(text).replace(verb, ' ').replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
}

/** Recupera acentos e maiúsculas do texto original para um trecho normalizado ("gas" → "gás"). */
function fromOriginal(text, phrase) {
  const toks = String(text).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const out = norm(phrase).split(' ').filter(Boolean).map((w) => toks.find((o) => norm(o) === w) || w).join(' ');
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

export const HELP = `Sem a IA, eu entendo frases simples. Exemplos:
• "como estou?" ou "o que faço agora?"
• "caiu 840 do adiantamento" · "recebi 150 de bico"
• "paguei a luz" · "paguei 300 do cartão"
• "gastei 30 no uber"
• "vai cair 1600 de salário dia 5" · "vale-alimentação de 600 dia 1"
• "devo 200 pra minha mãe" · "cadastra boleto da escola 350 dia 10"
• "cria um pote de 300 pro gás" · "me lembra de ligar pro banco sexta"
• "passa 200 da bipa pro cofrinho" · "tira 100 do cofrinho pra conta"
• "quanto gastei de uber?" · "como distribuir o salário?" · "desfaz"`;

/**
 * @returns {{tool: string, args: object} | {reply: string}}
 */
export function parseBasic(text, today) {
  const t = norm(text);
  const valor = parseMoneyBR(text);
  const data = parseDateBR(text, today);
  if (!t) return { reply: HELP };

  if (/^(ajuda|help|comandos|o que (voce|vc) (faz|sabe)|como (te )?uso)/.test(t)) return { reply: HELP };
  if (/^(desfaz|desfazer|desfaca|volta|voltar|cancela a ultima|errei)/.test(t)) return { tool: 'desfazer', args: {} };
  if (/(ultimas acoes|o que (eu )?fiz)/.test(t)) return { tool: 'ultimas_acoes', args: {} };

  // mover saldo entre contas: "passa 200 da bipa pro cofrinho", "tira 100 do cofrinho pra conta"
  if (/\b(move|mover|moveu|passa|passar|passei|manda|mandar|mandei|transfere|transferir|transferi|joga|jogar|joguei|tira|tirar|tirei|resgata|resgatar|resgatei|coloca|colocar|botei|bota|guarda|guardar|guardei|deposita|depositar)\b/.test(t)
      && /\b(cofrinh\w*|caixinh\w*|limite|garantia|colateral|conta corrente|pix|conta)\b/.test(t)
      && /(\bpr[ao]\b|\bpara\b|\bem\b|\bno\b|\bna\b|\bpro\b|\bpra\b|\bdo\b|\bda\b|\bde\b)/.test(t)
      && !/pote|lembr/.test(t)) {
    const todo = /\b(tudo|todo|total)\b/.test(t);
    // divide em origem/destino: "da X pro Y" | "pro Y da X"
    const orig = t.match(/\b(?:d[aoe]s?|de)\s+(.+?)(?=\s+(?:pr[ao]|para|no|na)\b|$)/);
    const dest = t.match(/\b(?:pr[ao]|para)\s+(?:o |a |meu |minha )?(.+?)(?=\s+(?:d[aoe]s?|de)\b|$)/) || t.match(/\b(?:no|na)\s+(.+?)(?=\s+(?:d[aoe]s?|de)\b|$)/);
    const tira = /\b(tira|tirar|tirei|resgata|resgatar|resgatei)\b/.test(t);
    const clean = (x) => (x || '').replace(/\d[\d.,]*( mil)?/g, ' ').replace(/\b(r|reais|real|o|a|meu|minha|saldo|que|tenho|tem|dinheiro)\b/g, ' ').replace(/\s+/g, ' ').trim();
    let de = clean(orig?.[1]); let para = clean(dest?.[1]);
    if (tira && !orig && dest) { de = para; para = 'conta corrente pix'; } // "tira 100 do cofrinho" sem destino
    if (tira && orig && !dest) { de = clean(orig[1]); para = 'conta corrente pix'; }
    if (/\b(guarda|guardar|guardei|coloca|colocar|botei|bota)\b/.test(t) && !orig && dest) { para = clean(dest[1]); de = 'conta corrente pix'; }
    if (de || para) return { tool: 'mover_saldo', args: { de, para, valor: todo ? 'tudo' : valor || undefined } };
  }

  // peças
  if (/(cria|criar|faz|fazer|monta|montar|abre|abrir|quero) (um |uma )?pote/.test(t) || /^pote /.test(t)) {
    const nome = t.replace(/.*pote/, '').replace(/\b(de|com) (r )?\d[\d.,]*( mil)?/g, ' ').replace(/\b(ate|pra|pro|para|de|do|da|o|a)\b/g, ' ').replace(/\bdia \d+\b|\d+/g, ' ').replace(/\s+/g, ' ').trim();
    return { tool: 'criar_peca', args: { peca: 'pote', nome: fromOriginal(text, nome || 'meu pote'), meta: valor, prazo: data } };
  }
  if (/(me lembra|me lembre|lembrete|lembrar de|me avisa)/.test(t)) {
    const texto = String(text).replace(/.*?(me lembr[ae]|lembrete( de| para| pra)?|lembrar|me avisa)\s*(de|que|pra|para)?\s*/i, '').replace(/\s*(todo )?dia \d{1,2}.*$|\s*(amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b.*$|\s*\d{1,2}\/\d{1,2}.*$/i, '').trim();
    const mensal = t.match(/todo (santo )?dia (\d{1,2})/);
    const antes = t.match(/(?:(\d{1,2}) dias? )?antes (?:de |do |da )?(?:vencer )?(?:o |a |do |da )?(.+)$/);
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    if (antes) {
      const conta = fromOriginal(text, antes[2].replace(/\bvencer\b/, '').trim());
      const cut = String(texto || '').replace(/\s*(\d{1,2}\s*dias?\s*)?antes\b.*$/i, '').trim();
      const own = cut ? cap(cut) : `Separar o dinheiro de ${conta}`;
      return { tool: 'criar_peca', args: { peca: 'lembrete', texto: own, antes_de: conta, dias: antes[1] ? Number(antes[1]) : 2 } };
    }
    if (mensal) return { tool: 'criar_peca', args: { peca: 'lembrete', texto: cap(texto), dia_do_mes: Number(mensal[2]) } };
    return { tool: 'criar_peca', args: { peca: 'lembrete', texto: cap(texto), data: data || today } };
  }
  if (/(sempre que|toda vez que|quando cair|quando entrar)/.test(t) && /(separa|guarda|coloca|poe)/.test(t)) {
    const quando = (t.match(/(?:sempre que|toda vez que|quando) (?:cair|entrar|receber)? ?(?:o |a |meu |minha )?([a-z ]+?)(?: separa| guarda| coloca| poe|,)/) || [])[1] || '';
    const pote = fromOriginal(text, (t.match(/pote (?:d[aoe] |pr[ao] |para )?([a-z ]+)$/) || t.match(/(?:pr[ao]|para) (?:o |a )?([a-z ]+)$/) || [])[1] || 'Reserva');
    const pct = t.match(/(\d{1,3}) ?(%|por cento)/);
    return { tool: 'criar_peca', args: { peca: 'regra', quando: quando.trim(), pote: pote.trim(), ...(pct ? { percentual: Number(pct[1]) } : { valor }) } };
  }
  if (/(cria|criar|nova|novo|adiciona) (uma )?categoria/.test(t)) {
    return { tool: 'criar_peca', args: { peca: 'categoria', nome: fromOriginal(text, t.replace(/.*categoria( de| para| pra)?/, '').trim()).toLowerCase(), direcao: /entrada/.test(t) ? 'entrada' : 'saida' } };
  }
  if (/(cria|criar|faz|monta) (um )?painel/.test(t)) {
    const alvo = t.replace(/.*painel( de| do| da| com| para| pra)?/, '').replace(/\b(gasto|gastos|quanto|gastei|no|na|mes|semana)\b/g, ' ').trim();
    return { tool: 'criar_peca', args: { peca: 'painel', titulo: `${alvo || 'Gastos'} no mês`, filtro: alvo, formula: /hora/.test(t) ? 'total / hora' : '' } };
  }
  const pot = t.match(/(guarda|guardar|coloca|coloquei|guardei|separa|separei|tira|tirei|tirar) .*?pote (?:d[aoe] |pr[ao] )?([a-z ]+)$/);
  if (pot && valor) return { tool: 'guardar_no_pote', args: { pote: pot[2].trim(), valor, tirar: /^ti/.test(pot[1]) } };

  // consultas
  if (/(quando (eu )?(vou|vo|irei|consigo|vou conseguir|da pra|posso) ?(conseguir )?(respirar|ficar livre|sair (das|da) divida|quitar tudo|pagar tudo|zerar|limpar o nome)|respirar|livre das dividas|sair do vermelho|data (prevista|estimada) .*(pagar|quitar)|(pagar|quitar) todas as dividas|quanto tempo .*(pagar|quitar|sair))/.test(t)) {
    return { tool: 'quando_fico_livre', args: {} };
  }
  if (/quanto (eu )?(gastei|gasto|paguei|recebi|ganhei) (de|com|no|na|em)? ?(.+)/.test(t)) {
    const m = t.match(/quanto (?:eu )?(gastei|gasto|paguei|recebi|ganhei) (?:de |com |no |na |em )?(.+?)( (esse|este|no|neste) mes| na semana| esse ano)?$/);
    const dias = /semana/.test(t) ? 7 : /ano/.test(t) ? 365 : 30;
    return { tool: 'lancamentos', args: { texto: m?.[2] || '', dias, tipo: /recebi|ganhei/.test(t) ? 'entradas' : 'gastos' } };
  }
  if (/(distribuir|dividir o (salario|dinheiro)|plano|como (eu )?(uso|gasto) o (salario|adiantamento))/.test(t)) return { tool: 'plano', args: {} };
  if (/(o que (eu )?(faco|fazer|devo fazer)|proximo passo|por onde (eu )?comeco|me ajuda|to perdid|estou perdid)/.test(t)) return { tool: 'o_que_fazer', args: {} };
  if (/(quanto (eu )?devo|minhas dividas|contas a pagar|o que (eu )?(tenho que|preciso) pagar|o que vence|vencendo|atrasad)/.test(t) && !valor) {
    return { tool: 'contas_a_pagar', args: { filtro: /atrasad/.test(t) ? 'atrasadas' : /vence|vencendo|semana/.test(t) ? 'proximas' : undefined } };
  }
  if (/(previs|o que vai (entrar|cair)|quando cai)/.test(t) && !valor) return { tool: 'previsoes', args: {} };
  if (/(saldo|minhas contas|meus cartoes|meus vales|quanto tem n)/.test(t) && !valor) return { tool: 'minhas_contas', args: {} };
  if (/(como (eu )?(estou|to|ta|vai)|situacao|resumo|quanto (eu )?tenho|tenho dinheiro|da pra pagar)/.test(t) && !valor) return { tool: 'situacao', args: {} };

  // previsão (futuro)
  if (valor && (/(vai cair|vai entrar|vou receber|recebo|cai dia|prever|previsao|vai pingar)/.test(t) || (data && data > today && /(salario|adiantamento|vale|quinzena)/.test(t)))) {
    return { tool: 'prever_entrada', args: { tipo: t, valor, data } };
  }
  // entrada
  if (/^(caiu|recebi|entrou|ganhei|pingou|chegou|depositaram|me pagaram|veio)\b/.test(t) || /\b(caiu|recebi|entrou)\b/.test(t)) {
    return { tool: 'registrar_entrada', args: { valor, descricao: rest(text, /\b(caiu|recebi|entrou|ganhei|pingou|chegou|depositaram|me pagaram|veio)\b/g), data: data && data < today ? data : undefined } };
  }
  // pagamento de conta cadastrada
  if (/^(paguei|pago|quitei|pagar|acertei)\b/.test(t)) {
    const conta = rest(text, /\b(paguei|pago|quitei|pagar|acertei|parcela|a conta|conta)\b/g);
    return { tool: 'pagar', args: { conta, valor: valor || undefined, quitar_com_desconto: /quitei/.test(t) && /desconto/.test(t) ? 'sim' : undefined }, fallback: { tool: 'registrar_gasto', args: { valor, descricao: conta } } };
  }
  // gasto
  if (/^(gastei|comprei|saiu|torrei|usei)\b/.test(t) || /\b(gastei|comprei)\b/.test(t)) {
    const parc = t.match(/(?:em |parcelad[oa] em )?(\d{1,2}) ?(?:x|vezes)\b/);
    const tx = parc ? text.replace(/(?:em |parcelad[oa] em )?\d{1,2} ?(?:x|vezes)\b/i, ' ') : text;
    return { tool: 'registrar_gasto', args: { valor: parseMoneyBR(tx), descricao: rest(tx, /\b(gastei|comprei|saiu|torrei|usei|parcelado|parcelada)\b/g), parcelas: parc ? Number(parc[1]) : undefined } };
  }
  // dívida nova
  if (/(devo|to devendo|estou devendo|peguei emprestado|fiz um emprestimo|cadastra|cadastrar|nova conta|novo boleto|tenho um boleto|tenho uma divida)/.test(t) && valor) {
    const pessoa = t.match(/devo .*?(?:pra|para|a|ao|à) (?:minha |meu |o |a )?([a-z ]+)$/);
    const nome = pessoa ? pessoa[1] : rest(text, /\b(devo|to devendo|estou devendo|peguei emprestado|fiz um emprestimo|cadastra|cadastrar|nova conta|novo boleto|tenho um boleto|tenho uma divida|boleto|divida|emprestimo)\b/g);
    const tipo = pessoa ? 'pessoa' : /emprestimo/.test(t) ? 'emprestimo' : /cartao/.test(t) ? 'cartao' : /aluguel|luz|agua|internet|condominio|escola/.test(t) ? 'essencial' : 'boleto';
    const parc = t.match(/(\d{1,2}) ?x( de)? ?(\d[\d.,]*)/);
    return { tool: 'cadastrar_divida', args: { tipo, nome: nome || 'Dívida', valor: parc ? undefined : valor, parcela: parc ? parc[3] : undefined, parcelas: parc ? Number(parc[1]) : undefined, vencimento: data || undefined } };
  }
  const tela = t.match(/^(abre|abrir|mostra|ir para|vai para) (o |a |as |os )?(inicio|dinheiro|dividas|futuro|plano|pecas)/);
  if (tela) return { tool: 'abrir', args: { tela: tela[3] } };

  return { reply: `Não entendi essa no modo básico.\n\n${HELP}` };
}
