# SPEC.md — Sistema Tático de Resgate Financeiro & Soberania Web3 (PWA Serverless)

## 1. Visão Geral & Restrições de Arquitetura
- **Objetivo:** Aplicativo Web Progressivo (PWA) 100% *Local-First* e *Serverless* (hospedado no GitHub Pages) projetado para tirar o brasileiro do endividamento por meio de neurociência aplicada, triagem tática de risco e gamificação progressiva, conduzindo o excedente financeiro até a autocustódia em Bitcoin / Polygon.
- **Stack Obrigatória:**
  - HTML5 + CSS3 + JavaScript Vanilla (ES Modules nativos, zero framework pesado, buildless para deploy direto no GitHub Pages).
  - `manifest.webmanifest` + Service Worker (`sw.js`) com estratégia *Cache-First* para instalação nativa (`standalone`) e operação 100% offline.
  - `IndexedDB` para banco de dados local + `Web Crypto API` (AES-GCM) para criptografia opcional por PIN/Biometria + exportação/importação de backup em `.json` cifrado.
  - `Chart.js` (gráfico diário de fluxo) + CSS 3D / WebGL leve (60fps) para deck de cartões e totens volumétricos de dívida.

## 2. Invariantes Inegociáveis do Sistema
1. **Invariante Anti-Paralisia:** A tela inicial NUNCA soma dívidas em quarentena no saldo negativo principal. Exibe apenas: (a) Caixa Livre Real Hoje, (b) Alvo Prioritário nº 1 e (c) Horas de Vida Resgatadas.
2. **Invariante de Liquidez Real:** Saldos provenientes de limite de cartão de crédito, cheque especial, cartão de benefício restrito ou garantia travada em parcelas NUNCA podem ser contabilizados como excedente disponível para aporte em cripto.
3. **Invariante de Privacidade Zero-Server:** Nenhuma informação financeira, linha digitável de boleto ou dado de perfil sai do dispositivo do usuário.

## 3. Arquitetura Multi-Perfil & Núcleo Compartilhado ("Modo Casa")
- O cofre local suporta múltiplos perfis (`profiles[]`) no mesmo aparelho com troca rápida no cabeçalho, além de um contexto compartilhado (`household`) para moradores da mesma residência.
- Obrigações marcadas com `isShared: true` (ex: Aluguel R$ 2.500) dividem-se em cotas (`splitRatio` ou `fixedShare`) que alimentam individualmente a *Linha d'Água* de cada perfil, exibindo um status unificado de cobertura da casa.

## 4. Motor Neurocomportamental & Gamificação
### 4.1. Calibragem da Hora de Vida Real
- Fórmula: `valorHoraReal = rendaLiquidaMensal / (horasTrabalhadasMes + horasDeslocamentoMes)`.
- Todo juro mensal, multa de atraso, taxa de cartório evitada ou desconto por antecipação é convertido automaticamente em **Horas e Minutos de Vida**.

### 4.2. Matriz de Triagem em 3 Zonas ("Névoa de Guerra")
- **Zona 1 — Linha de Frente (Prioridade Máxima):**
  - Contas vitais (aluguel, pensão alimentícia, alimentação, transporte, ferramentas de trabalho como moto/carro alugado/insumos de loja).
  - Boletos com chave `canProtest: true` próximos da data limite de cartório. Gera *Cards de Missão* com script de negociação e contabiliza a taxa de cartório evitada (~R$ 200+) como *Dano Bloqueado*.
- **Zona 2 — Campo de Batalha (Sangria Ativa):**
  - Dívidas pessoais/familiares (*Quick Wins* para alívio emocional imediato) e cartões de crédito ativos ordenados pelo menor saldo (*Bola de Neve*).
  - **Regra de Corte de Limite:** Se `limitShrinking === true`, o sistema emite alerta para não sacrificar dinheiro de contas vitais pagando mínimo de cartão que não devolverá limite.
- **Zona 3 — Domo de Quarentena (Contenção):**
  - Dívidas antigas já multiplicadas por juros compostos abusivos ficam isoladas visualmente fora do fluxo diário até a Era III, aguardando caixa para liquidação à vista com superdesconto (70%–90%).

### 4.3. As 4 Eras Progressivas
- **Era I — Blindagem:** Nenhum boleto indo para protesto + construção do micro-escudo de liquidez (R$ 500 a R$ 1.000).
- **Era II — Demolição:** Quitação sequencial dos compromissos familiares e cartões ativos + migração dos gastos cotidianos para cartão pré-pago com garantia e cashback em BTC.
- **Era III — Quebra de Correntes:** Acúmulo de reserva tática para quitar à vista as dívidas seladas no *Domo de Quarentena*.
- **Era IV — Soberania Web3:** Inversão da barra de progresso; o fluxo mensal liberado alimenta marcos de acúmulo em Satoshis (`100k`, `1M`, `10M`, `100M Sats` rumo a `1.00 BTC`) e destrava a ponte de envio de excedentes para autocustódia (Bitcoin / Polygon).

## 5. Modelo de Dados Polimórfico (`IndexedDB` Schema v2.0)
```json
{
  "household": {
    "name": "Núcleo Familiar",
    "sharedWaterlineMonthly": 2500.00
  },
  "profiles": [
    {
      "id": "prof_01",
      "name": "Perfil Principal",
      "monthlyNetIncome": 3200.00,
      "monthlyWorkAndCommuteHours": 220,
      "realHourlyRate": 14.54,
      "currentEra": 1,
      "rescuedLifeMinutes": 960,
      "accumulatedSats": 24300
    },
    {
      "id": "prof_02",
      "name": "Perfil 2",
      "monthlyNetIncome": 2600.00,
      "monthlyWorkAndCommuteHours": 210,
      "realHourlyRate": 12.38,
      "currentEra": 1,
      "rescuedLifeMinutes": 0,
      "accumulatedSats": 0
    }
  ],
  "accounts": [
    {
      "id": "acc_bank_01",
      "profileId": "prof_01",
      "name": "Conta Corrente",
      "type": "checking_cash",
      "balance": 1180.00,
      "isRealLiquidity": true
    },
    {
      "id": "acc_bipa_01",
      "profileId": "prof_01",
      "name": "Cartão Bipa",
      "type": "collateralized_yield_crypto",
      "collateralTotal": 7000.00,
      "lockedInstallments": 6000.00,
      "limitAvailable": 1000.00,
      "isRealLiquidity": false,
      "yieldConfig": {
        "cdiPercent": 100,
        "cashbackPercent": 0.5,
        "payoutAsset": "BTC"
      }
    },
    {
      "id": "acc_caju_01",
      "profileId": "prof_01",
      "name": "Caju Benefícios",
      "type": "benefit_card",
      "balance": 320.00,
      "isRealLiquidity": false
    },
    {
      "id": "acc_cc_01",
      "profileId": "prof_01",
      "name": "Cartão Crédito",
      "type": "credit_card",
      "limitTotal": 4000.00,
      "limitAvailable": 120.00,
      "limitShrinking": true,
      "closingDay": 12,
      "dueDay": 19
    }
  ],
  "obligations": [
    {
      "id": "obl_rent_01",
      "profileId": "prof_01",
      "type": "vital_fixed",
      "bucket": "pessoal",
      "zone": "frontline",
      "beneficiary": "Aluguel Casa",
      "totalAmount": 2500.00,
      "isShared": true,
      "shareMode": "fixed",
      "fixedShare": { "prof_01": 1250.00 },
      "dueDate": "2026-12-05"
    },
    {
      "id": "obl_boleto_01",
      "profileId": "prof_02",
      "type": "boleto",
      "bucket": "negocio",
      "zone": "frontline",
      "beneficiary": "Fornecedor Pet Shop",
      "barcode": "23793381288600000000903000000046616380000060000",
      "principalAmount": 600.00,
      "dueDate": "2026-11-22",
      "rules": {
        "finePercent": 2.0,
        "dailyInterestPercent": 0.033,
        "canProtest": true,
        "protestDeadline": "2026-11-27",
        "estimatedProtestFee": 210.00
      }
    }
  ],
  "ledger": [
    {
      "id": "tx_01",
      "profileId": "prof_01",
      "date": "2026-11-20",
      "direction": "in",
      "amount": 840.00,
      "accountId": "acc_bank_01",
      "impactCashToday": true,
      "category": "adiantamento"
    }
  ]
}
```

> **Notas do Schema v2.0 (implementação):** `limitAvailable` é o nome único do limite livre (cartão de crédito e cartão com garantia; o app ainda aceita `availableLimit` na importação). No cartão com garantia, `limitAvailable = collateralTotal − lockedInstallments` sempre. Cota de conta compartilhada: `shareMode` = `equal` | `ratio` (`splitRatio`) | `fixed` (`fixedShare`; quem não tem cota fixa divide o restante). `zone` é opcional: vazio = triagem automática; preenchido = escolha manual do usuário.

## 6. Leitor Offline de Boleto (`boletoParser.js`)
 * Entrada: String numérica (47 dígitos para títulos bancários, 48 dígitos para concessionárias, ou 44 dígitos do código de barras lido por câmera) via colagem ou scanner.
 * Processamento 100% client-side:
   * Remove pontuação e valida dígitos verificadores (Módulo 10 / Módulo 11).
   * Para títulos bancários (47 dígitos): extrai bankCode (posições 0–3), dueFactor (posições 33–37, aplicando cálculo de data base FEBRABAN pós-virada de 22/02/2025) e amount (posições 37–47 divididos por 100).
   * Retorna objeto pré-preenchido { bankCode, dueDate, amount, isValid } em < 5ms sem requisições de rede.
## 7. Ergonomia Visual, HUD & Estrutura de Diretórios
 * Paleta: Midnight Carbon (#0F1115) de fundo, superfícies elevadas (#161920), tipografia geométrica de alto contraste, Magenta Neon (#FF007F) para alertas de juros/protesto e Ciano (#00BFFF) para liquidez real e Satoshis.
 * 4 Visões Principais:
   * HUD Tático: Seletor de Perfil, placar de Horas Resgatadas, Simulador "Caiu Dinheiro" (fatiador automático de entradas) e Card do Alvo Prioritário nº 1.
   * Carteira & Onda: Deck 3D de cartões/contas (mostrando saldo vs. garantia travada no cartão Bipa), Gráfico Diário de Fluxo com Linha d'Água dos próximos 15 dias e botão rápido de lançamento (+ / -).
   * Campo de Batalha: Totens volumétricos em 2 camadas (base = principal; topo pulsante = juros/multas), 5 botões contextuais (+ Boleto [Colar Código], + Cartão, + Pix/Pessoa, + Financiamento, + Vital/Casa) e cofre recolhido do Domo de Quarentena.
   * Cofre Soberano: Placar unificado de Satoshis (rendimento CDI + cashback + aportes diretos), trilha visual rumo a 1.00 BTC e ponte Web3 condicionada à Trava de Liquidez Real.
```
/
├── index.html
├── manifest.webmanifest
├── sw.js
├── /assets/icons/
├── /css/
│    └── tokens.css
└── /js/
     ├── app.js
     ├── db/vault.js
     ├── parsers/boletoParser.js
     ├── engines/
     │    ├── lifeHours.js
     │    ├── triage.js
     │    ├── cashflow.js
     │    └── eraMachine.js
     └── ui/
          ├── deck3d.js
          ├── flowChart.js
          └── wizards.js
```
