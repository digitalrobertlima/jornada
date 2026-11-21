# Jornada — Resgate Financeiro & Soberania

PWA **local-first e sem servidor** para tirar o brasileiro da dívida com triagem tática, horas de vida resgatadas e um caminho até a soberania em Bitcoin.

**App:** https://digitalrobertlima.github.io/jornada/ · instalável no Android, iOS e desktop.

Especificação mestre: [`SPEC.md`](./SPEC.md).

## O que já funciona (v1.0)

- **Triagem em 3 Zonas:** Linha de Frente (vitais + boletos que podem ir a cartório), Campo de Batalha (Quick Wins com pessoas + Bola de Neve do menor saldo) e Domo de Quarentena (dívidas antigas estouradas, fora do fluxo diário).
- **Invariante Anti-Paralisia:** o HUD mostra só Caixa Livre Real, Alvo nº 1 e Horas de Vida Resgatadas. A quarentena nunca entra nesses números.
- **Hora de Vida Real:** renda ÷ (horas de trabalho + deslocamento). Todo juro, multa, taxa de cartório evitada e desconto vira horas e minutos de vida.
- **Cards de Missão** com contador regressivo, roteiro de ligação copiável e botão **Protesto Segurado**.
- **Linha d'Água** (vitais + protestáveis dos próximos 15 dias) e **Onda de Liquidez** diária em SVG nativo, com os dias que furam o piso em destaque.
- **Simulador "Caiu Dinheiro"**: fatia o valor entre micro-escudo e Alvo nº 1 e mostra o totem encolhendo e as horas subindo antes de confirmar.
- **Leitor de boleto offline**: 47, 48 e 44 dígitos, Módulo 10/11 e a virada do fator de vencimento de 22/02/2025.
- **Contas polimórficas:** conta corrente (liquidez real), benefício restrito, cartão de crédito com detector de corte de limite e cartão com garantia (modelo Bipa), cujo rendimento CDI e cashback viram sats.
- **Parcelamento em qualquer dívida** (Pix/Pessoa, boleto/carnê, cartão, financiamento): o app cobra uma parcela por vez, mostra "parcela 1/3" com barra de progresso e avança vencimento e prazo de cartório a cada parcela paga.
- **Atraso visível:** selo "Atrasada", anel magenta no totem, quanto o atraso já somou em multa e juros, aviso no HUD e contador na aba; selo âmbar quando vence em até 3 dias.
- **Guia financeiro e desfazer total (v1.4):** a tela inicial mostra o próximo passo com o motivo; toda ação pode ser desfeita por inteiro. Ver [`UX-REVIEW.md`](./UX-REVIEW.md).
- **Multi-perfil + Modo Casa:** contas da casa divididas em cotas, com cobertura conjunta.
- **4 Eras** e **Trava de Soberania**: nenhum real vai para cripto com Linha de Frente aberta ou Linha d'Água furada.
- **Cotações ao vivo** (BTC/BRL e CDI) buscadas direto do navegador em APIs públicas, com várias fontes de reserva, cache local e valor manual.
- **Backup** `.json` para exportar e importar, e **Cenário Realista de Teste** com um toque.

Próxima rodada: PIN com criptografia AES-GCM, backup cifrado, leitura de boleto pela câmera e ponte de autocustódia (endereços BTC/Polygon).

## Privacidade

Nenhum dado financeiro, linha digitável ou perfil sai do aparelho. Tudo fica no IndexedDB do navegador. As únicas chamadas de rede são pedidos de cotação (BTC e CDI), que não levam nenhum dado do usuário e podem ser desligados nos Ajustes.

## Arquitetura

HTML + CSS + JavaScript (ES Modules nativos), **sem build e sem dependências**. Todos os caminhos são relativos, então o app funciona em `/jornada/` no GitHub Pages.

```
index.html · manifest.webmanifest · sw.js (cache-first versionado)
css/tokens.css (design system) · css/app.css
js/app.js (boot, abas, rotinas diárias) · js/store.js (estado + persistência)
js/core/      datas, formatação, Schema v2.0 e normalizadores
js/db/        vault.js (IndexedDB) · demoScenario.js
js/parsers/   boletoParser.js
js/engines/   lifeHours · triage · cashflow · eraMachine · satsYield · scripts
js/services/  market.js (cotações ao vivo)
js/ui/        deck3d (deck + totens 3D) · flowChart (SVG) · wizards · simulator · settings · views/
tests/        node --test
```

## Rodar localmente

```bash
python3 -m http.server 8000   # abra http://localhost:8000
npm test                      # 28 testes dos motores e do leitor de boleto (Node 20+)
```

Ao publicar uma nova versão, troque `VERSION` em `sw.js` para os aparelhos receberem a atualização.

## Salvar no Google (v1.5.0)

- **Sem login, sem configuração:** em *Ajustes → Salvar no Google Drive* o celular abre a folha de compartilhamento com o arquivo de backup; a pessoa escolhe o Drive e pronto. No computador, o arquivo é baixado e o Drive abre para arrastar.
- **Login Google com sincronização automática (opcional):** o Google exige um *Client ID* (criado uma única vez pelo dono do app, não pelos usuários). Passos: console.cloud.google.com → novo projeto → ativar *Google Drive API* → tela de consentimento → Credenciais → *ID do cliente OAuth* (Aplicativo da Web) com origem `https://digitalrobertlima.github.io` → colar em `js/config.js` (`googleClientId`). Sem o ID, os botões de login ficam ocultos.

## Previsão de entradas e plano de distribuição (v1.6.0)

- **Prever uma entrada** (Dinheiro → "Previsão de entradas"): salário, adiantamento, vale-alimentação, vale-transporte, extra. Para cada uma o app pergunta se cai **livre via Pix** ou **travada** em vale/cartão benefício (e para qual uso: alimentação, transporte, outro). "Repete todo mês" prevê o mês seguinte ao confirmar.
- A previsão **não vira saldo sozinha**: só quando você toca em **"Caiu!"** (com o valor real). Dá para desfazer.
- **Como distribuir** cruza as entradas previstas com as contas que vencem e sugere, em ordem: essenciais → cartório → atrasadas → reserva → adiantar dívidas. Segura o dinheiro de hoje para o aluguel que vence antes do próximo pagamento, usa o vale-alimentação só para conta de alimentação e avisa quando uma conta vence **antes** do dinheiro chegar (com roteiro para pedir nova data).
- Todo lançamento de entrada pergunta "caiu como Pix (livre) ou travado?"; cartões benefício agora têm finalidade.

## Assistente 100% offline + peças (v2.0.0)

**Assistente** (botão central da barra de baixo, ou atalho do ícone instalado): a pessoa conversa e ele usa o app sozinho.

- **Modo básico** (qualquer celular, na hora, sem IA): entende frases como "caiu 840 do adiantamento", "paguei a luz", "gastei 30 no uber", "vai cair 1600 de salário dia 5", "cria um pote de 300 pro gás", "me lembra de ligar pro banco sexta", "quanto gastei de uber?", "como distribuir o salário?", "desfaz".
- **IA no aparelho** (opcional): Gemma 4 E2B via LiteRT-LM (WebGPU). Baixa ~2 GB uma vez para o armazenamento privado do navegador (OPFS), com pausa/retomada; o motor vem do CDN na primeira vez e o service worker guarda. Depois, conversa sem internet e nada sai do celular. Requisitos: Chrome atualizado no Android 12+ (GPU Qualcomm/ARM) ou iOS 26+, ~2,2 GB livres; 6 GB+ de RAM recomendado. Se o motor exigir isolamento (SharedArrayBuffer), o app oferece "Reabrir no modo da IA" e o service worker aplica COOP/COEP (`?isolar=1`).
- **Segurança**: o modelo não executa nada. Ele pede ferramentas (`js/agent/tools.js`) que usam as mesmas funções dos botões; leitura devolve texto, escrita devolve **prévia** e só grava quando a pessoa toca em Confirmar. Tudo vai para o histórico (desfazer). Números vêm dos motores, nunca do modelo; contas usam a fórmula segura (sem `eval`). Prévias de pagamento avisam quando o dinheiro das contas essenciais ficaria descoberto.

**Peças** (`js/recipes/`): funções novas montadas sem programar, pela pessoa (Ajustes → Peças) ou pelo assistente.

| Peça | Faz |
|---|---|
| Categoria | tipo novo de gasto/entrada no lançamento rápido |
| Pote | separa dinheiro para um objetivo, com meta e prazo (o dinheiro continua na conta) |
| Regra | quando entrar um dinheiro (por nome/categoria/valor mínimo), separa R$ ou % num pote — no mesmo registro, desfazível |
| Lembrete | numa data, todo mês ou N dias antes de uma conta vencer; aparece na tela inicial e, com app instalado e notificação liberada, avisa pelo celular (Periodic Background Sync, quando o aparelho permite) |
| Painel | número na tela inicial (ex.: "Uber no mês"), com filtro, período e fórmula segura (`total / hora` = horas de trabalho) |

Peças são dados: entram no backup e na sincronização, têm desfazer e podem ser desligadas. Quando nada resolve, o assistente anota um **pedido de função** (Ajustes → Pedidos de função → Enviar abre uma issue no GitHub com o texto, nenhum dado pessoal).

Testes: `npm test` (unidade, sem navegador). O caminho da IA é testado com um modelo simulado (`window.__JORNADA_FAKE_LLM__`); o modelo real só roda no celular.

## v2.4 — Mover saldo
Botão **⇄ Mover saldo** (aba Dinheiro e verso de cada cartão) passa dinheiro entre Pix, cofrinhos (novo tipo, rende % do CDI) e o limite do cartão com garantia (Bipa). Não é gasto nem entrada, e tem "Desfazer". O assistente entende: "passa 200 da bipa pro cofrinho", "tira 100 do cofrinho".
