# Regras e Diretrizes — ClickPulse ⚡

Regras operacionais, diretrizes de engenharia e protocolo multi-agente otimizado para o repositório **ClickPulse** (Engine analítica web cookieless de alta performance para ClickHouse & SigNoz).

---

## 1. Execução Local Obrigatória de Testes (Regra de Ouro)

Após **qualquer alteração** em código (`packages/tracker/`, `packages/edge-worker/`, `packages/sync-cli/`, scripts ou configurações), é **estritamente obrigatório correr a suite de testes e verificação de tipos localmente** antes de dar a tarefa por concluída ou sugerir commits *(exceção: edições puramente documentais)*.

- **Suite de Testes Completa (Obrigatória, `exit code 0`):** `npm test`
- **Verificação de Tipos (TypeScript):** `npm run typecheck`
- **Build & Verificação de Bundle do Tracker:** `npm run build`
  - **Orçamento Rígido de Bundle:** `public/tracker.min.js` deve ter **< 1.5 KB** gzipped (`gzip -c public/tracker.min.js | wc -c` <= 1536 bytes).
- **Iteração Focada (Economia de Recursos & Tokens):**
  - Tracker: `npx vitest run packages/tracker/src/<arquivo>.test.ts`
  - Edge Worker: `npx vitest run packages/edge-worker/src/<arquivo>.test.ts`
- **Tolerância Zero:** Nunca assumir passagem sem executar. Proibido desativar ou afrouxar `expect()` / `assert`s para forçar testes verdes.
- **TDD / Reproducer First:** Qualquer correção de bug exige primeiro um teste unitário que reproduza a falha (Red -> Green).

---

## 2. Guardrails Arquiteturais & Privacidade

- **Cookieless & Privacidade (GDPR / ePrivacy):**
  - **Zero Cookies:** Proibido utilizar `document.cookie` ou qualquer cookie persistente no tracker.
  - **Sessões Efémeras:** O tracker utiliza exclusivamente `sessionStorage` com janela rolante de inatividade de 30 minutos.
  - **Anonimização de Visitantes:** O Edge Worker gera `visitor_id` com rotação diária via HMAC-SHA256 (`daily_salt + IP + UserAgent`), inviabilizando rastreamento cross-day ou PII persistence.
  - **Zero Dependências no Tracker:** O script cliente `packages/tracker` tem 0 dependências runtime de terceiros.
- **Ingestão no Edge & ClickHouse:**
  - **Streaming Direto Protegido:** Ingestão HTTP direta no ClickHouse usando `async_insert=1` e `wait_for_async_insert=0`.
  - **Shield 1 (Rede Zero Trust):** Validação de tokens de serviço Cloudflare Access (`CF-Access-Client-Id` e `CF-Access-Client-Secret`).
  - **Shield 2 (Perfil de Utilizador Sandboxed):** Credenciais exclusivas para `INSERT`, limite estrito de 50 MB de RAM e timeout de 2s.
  - **Shield 3 (Shock Absorber):** Em caso de indisponibilidade ou latência excessiva do ClickHouse (>800ms), encaminhar eventos automaticamente para a tabela spool do Cloudflare D1 (`schema-d1.sql`). Zero perda de eventos.
- **Esquema ClickHouse (`schema.sql`):**
  - Tabela principal `clickpulse.analytics_events` sob `ENGINE = MergeTree()`, particionada por mês `toYYYYMM(created_at)`.
  - Ordenação primária obrigatória: `(site_id, event_type, toDate(created_at), session_id, created_at)`.
  - Compressão com codecs adequados: `DoubleDelta, ZSTD(1)` para timestamps e `ZSTD(3)` para cargas JSON.

---

## 3. Protocolo Proporcional de Desenvolvimento (Otimização de Custos de Workflow & Tokens)

Para minimizar o consumo de tokens LLM e minutos de execução em CI sem comprometer a qualidade, selecione o tier proporcional à complexidade da tarefa:

| Tier | Âmbito / Critério | Fluxo de Execução | Gate de Qualidade |
| :--- | :--- | :--- | :--- |
| **Tier 1: Fast-Track** *(~90% das tarefas)* | Bugfix isolado, ajuste de testes, tipagem, melhoria em 1 módulo, documentação (≤ 2 ficheiros) | Agente principal executa diretamente em fluxo único: Teste reprodutor -> Correção -> Verificação local | `npm test` + `npm run typecheck` (100% verde) |
| **Tier 2: Standard** | Nova funcionalidade ou refactor num único pacote (`tracker`, `edge-worker` ou `sync-cli`, 3–6 ficheiros) | 1 Revisão técnica rápida (`@edge-worker-engineer` ou `@tracker-engineer`) -> Implementação -> Validação de QA | Spec/Plano conciso + `npm test` + validação de bundle (<1.5KB se tracker) |
| **Tier 3: Full Council** | Alteração em esquema de banco (`schema.sql`), quebra de protocolo entre Tracker e Edge, ou redesenho do Shock Absorber | Protocolo completo: auditoria de resiliência (`@sre-sentinel`) + especificação (`@clickhouse-architect`) + implementação e peer review | Auditoria SRE + Validação de esquemas + `npm test` 100% verde + Checklist `code-review` |

### Regras para Redução de Custo de Workflow
1. **Evitar Multi-Agentes Desnecessários:** Nunca invocar múltiplos subagentes para tarefas de Tier 1. Executar no agente principal de forma direta e concisa.
2. **Testes Direcionados Primeiro:** Durante o ciclo de iteração, rode apenas o ficheiro de teste afetado (`npx vitest run <caminho>`). Só execute o suite completo `npm test` no gate final.
3. **Comunicação Concisa:** Prompts e mensagens entre agentes devem ser objetivos e técnicos, sem prolixidade ou dados redundantes de contexto.

---

## 4. Definition of Done (DoD)

1. `npm test` 100% verde (`exit code 0`).
2. `npm run typecheck` sem qualquer erro de tipagem TypeScript.
3. Se o Tracker (`packages/tracker`) for alterado: `npm run build` executado e tamanho gzipped de `public/tracker.min.js` inferior a 1.5 KB.
4. Respeito integral aos princípios de privacidade e resiliência (Zero Cookies, D1 Spool fallback ativo).
5. Commits em formato Conventional Commits (`feat:`, `fix:`, `chore:`, `perf:`).
