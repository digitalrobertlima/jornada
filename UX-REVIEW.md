# Revisão de UX — v1.4 (19/11/2026)

## O problema
Quem está endividado decide sob pressão. A pesquisa sobre escassez (Mullainathan & Shafir) mostra que a falta de dinheiro ocupa a "largura de banda" mental: sobra menos atenção para planejar e controlar impulsos. Uma tela cheia de números e nomes novos piora isso, e a pessoa trava.

## Princípios adotados
1. **Um próximo passo por vez.** A tela inicial abre com "Seu próximo passo": o que fazer, por que (uma frase) e o botão que já faz.
2. **Linguagem simples.** Sem jargão na interface: "Linha de Frente" virou "Urgente", "Linha d'Água" virou "contas essenciais dos próximos 15 dias", "Quick Win" virou "vitória rápida", "Protesto Segurado" virou "Paguei antes do cartório". As abas viraram Início, Dinheiro, Dívidas e Futuro.
3. **Padrão seguro.** Nada é pago sem pedido explícito. "Entrou dinheiro" só registra a entrada; pagar uma conta é opcional, e o botão diz exatamente o que vai acontecer.
4. **Tudo pode ser desfeito.** Cada ação vira um registro no diário. Desfazer volta tudo o que foi feito junto: entrada, pagamento, parcela, conta do mês seguinte e horas de vida. Funciona mesmo depois de outras ações, porque saldos são revertidos por diferença, sem apagar o que veio depois.
5. **Tudo é tocável.** Cada número abre o que está por trás dele: dinheiro, vitórias, contas essenciais, cada lançamento.
6. **Vitórias visíveis.** Fechar dívidas, mesmo pequenas, prevê quem sai da dívida (Gal & McShane, 2012; cerca de 6 mil pessoas). O app conta dívidas quitadas, mostra torres de parcelas que ficam azuis e uma tela de vitória a cada pagamento.
7. **Progresso perto da meta.** Pelo efeito de gradiente de meta (Kivetz, Urminsky & Zheng, 2006), o esforço aumenta perto do fim. O Guia destaca "falta só 1 parcela".

## Guia financeiro (ordem de prioridade)
1. Boleto indo a cartório → roteiro de ligação / paguei.
2. Conta essencial atrasada.
3. Falta dinheiro para as essenciais dos 15 dias → saídas em ordem: segurar gastos, mudar data, renda extra; empréstimo só em último caso.
4. Cartão com corte de limite → não pagar mínimo com dinheiro essencial.
5. Dívidas atrasadas rodando juros.
6. Juro mensal alto → pedir quitação antecipada com desconto.
7. Vencimentos em até 7 dias.
8. Sobrou dinheiro → completar a reserva e depois quitar uma dívida inteira (vitória rápida).
9. Última parcela.

## Erros corrigidos
- "Caiu dinheiro" mandava parte do valor para o Alvo nº 1 sem a pessoa pedir.
- "Desfazer" apagava só a entrada e deixava o pagamento, então o dinheiro sumia.
- Avisos se empilhavam e cobriam o título dos formulários.

## Próximos passos sugeridos
- Teste com 3 a 5 pessoas reais (não técnicas): pedir para registrar uma entrada, pagar uma conta e desfazer, observando onde travam.
- Modo "letra grande" e leitura em voz alta dos passos.
- Lembretes de vencimento (notificação local do PWA).
