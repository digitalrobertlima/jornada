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
