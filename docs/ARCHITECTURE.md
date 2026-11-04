# Arquitetura e decisões técnicas

## Objetivos

A arquitetura foi mantida pequena o suficiente para um projeto acadêmico, mas com fronteiras que permitem evolução para SaaS:

- preservar o frontend React existente;
- impedir que o navegador seja fonte de verdade;
- isolar cada clínica desde o primeiro registro;
- executar regras financeiras e conversões em transações;
- permitir desenvolvimento sem contratar infraestrutura;
- usar PostgreSQL padrão em produção, sem acoplamento obrigatório a um único fornecedor.

## Componentes

### Frontend — `apps/web`

- React 19 e TypeScript;
- Vite 8 e Tailwind CSS 4;
- React Router para rotas e módulos;
- Recharts para visualizações;
- `api.ts` como fronteira HTTP;
- provider React para sessão, dados carregados, fila de comandos e estado puramente visual;
- `initialData` disponível somente após entrada explícita no modo demonstração.

O frontend não recebe credencial de banco e não decide permissões. Ocultar uma ação melhora a experiência, mas a autorização final sempre pertence à API/banco.

### API — `apps/api`

- Node.js 22 e TypeScript;
- Fastify 5;
- Zod para validação de ambiente e comandos;
- cookies, CORS, headers de segurança e rate limit por plugins oficiais do Fastify;
- consultas SQL explícitas e parametrizadas;
- adaptador único para PostgreSQL (`pg`) e PGlite;
- migrações aplicadas em ordem e registradas em `schema_migrations`.

As rotas são separadas por responsabilidade:

- `auth.ts`: cadastro, login, sessão, logout e recuperação;
- `bootstrap.ts`: projeção tenant-scoped compatível com a interface e filtrada por permissão;
- `commands.ts`: mutações específicas, autorização, transações, idempotência e auditoria.

### Banco

`001_initial.sql` é portável entre PostgreSQL e PGlite e cria o modelo completo. `002_postgres_hardening.sql` é aplicado somente em PostgreSQL real e adiciona extensões, conflitos de agenda no banco, triggers, imutabilidade financeira/auditoria e políticas RLS.

PGlite é uma conveniência de desenvolvimento e teste; não é o banco recomendado para múltiplos usuários nem para produção.

## Autenticação escolhida

Foi usada autenticação própria, server-side, em vez de Supabase Auth:

1. o backend já precisa existir para regras transacionais e permissões;
2. a aplicação continua portátil entre fornecedores PostgreSQL;
3. todo o fluxo pode ser testado localmente sem conta externa;
4. o navegador recebe somente um cookie de sessão opaco.

Controles implementados:

- senha derivada com `scrypt`, salt aleatório e formato versionado;
- token de sessão aleatório; o banco guarda apenas SHA-256;
- cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- sessão vinculada a usuário, associação e clínica;
- invalidação imediata quando usuário, clínica ou associação deixa de estar ativa;
- logout com revogação server-side;
- recuperação com token de uso único, expiração e revogação das sessões anteriores;
- resposta uniforme para conta/senha inválidas.

Supabase continua sendo uma opção de hospedagem PostgreSQL; usar seu banco não exige adotar o Auth.

## Multi-tenancy e autorização

Quase toda entidade operacional possui `clinic_id`. Chaves estrangeiras compostas impedem relacionamentos acidentais entre clínicas. Toda consulta da API inclui o tenant autenticado; um identificador enviado pelo cliente nunca substitui `request.auth.clinicId`.

O modelo contém:

- `permissions` globais;
- `roles` por clínica;
- `role_permissions` por clínica e papel;
- `clinic_memberships` ligando usuário, clínica e papel;
- sessão ligada à associação ativa.

Em PostgreSQL, a migração de endurecimento cria políticas RLS para papéis de banco restritos e futuros acessos diretos. A API usa uma conexão privada do backend e é responsável pelos predicados explícitos de tenant/permissão. `FORCE ROW LEVEL SECURITY` não é usado para não bloquear o fluxo do proprietário do esquema; isso torna indispensáveis:

- nunca expor a credencial da API no cliente;
- não conceder o papel proprietário a pessoas, BI ou integrações;
- usar papéis sem `BYPASSRLS` para acessos secundários;
- validar as políticas com um papel restrito em PostgreSQL de homologação;
- registrar contexto de usuário/clínica/associação nas transações para auditoria.

RLS é defesa em profundidade, não substituto dos filtros e verificações do backend.

## Modelo de dados

### Identidade e tenant

- `app_users`, `user_sessions`, `password_reset_tokens`;
- `clinics`, `clinic_preferences`;
- `clinic_memberships`, `clinic_invites`;
- `roles`, `permissions`, `role_permissions`;
- `professionals`, `clinic_locations`, `clinic_resources`.

### Pacientes e operação clínica

- `patients`, `tags`, `patient_tags`, `patient_consents`;
- `appointments`, `appointment_status_history`;
- `treatments`, `treatment_steps`, `treatment_status_history`;
- `clinical_evolutions`, `medications`, `clinical_documents`;
- `patient_interactions`, `follow_up_tasks`.

### Comercial e financeiro

- `quotes`, `quote_items`, `quote_status_history`;
- `receivables`, `installments`;
- `payments`, `payment_allocations`;
- view `installment_balances`.

Valores são `numeric(14,2)`. Parcelas e alocações usam restrições e, no PostgreSQL endurecido, triggers contra estouro do total. Conversão de orçamento e registro de pagamento são operações idempotentes/transacionais.

### Integrações, automação e governança

- `integration_configs`, sem segredo em texto; `secret_ref` deve apontar para um cofre;
- `message_templates`, `message_events` e `webhook_events`;
- `automation_rules`, `automation_runs`, `scheduled_jobs`;
- `api_idempotency_keys`;
- `audit_logs`;
- `data_retention_policies`, `data_erasure_requests`.

Essas tabelas preparam o domínio, mas criar uma tabela não significa que um provedor, fila ou rotina esteja ativo.

## Consistência temporal e financeira

- instantes são `timestamptz` em UTC;
- data/hora local de consultas é convertida com o fuso da clínica;
- o fuso inicial é `America/Sao_Paulo`;
- datas sem horário, como vencimento, usam `date`;
- valores persistidos usam decimal, não ponto flutuante;
- divisão de parcelas deve ocorrer em centavos e distribuir o resto determinísticamente;
- pagamento não pode superar o saldo sem regra explícita;
- estados concluído/cancelado exigem seus respectivos timestamps.

## Bootstrap e comandos

`GET /api/bootstrap` entrega apenas a projeção necessária para a UI:

- omite módulos sem permissão;
- zera valores de tratamento quando o perfil não pode ler detalhes financeiros;
- filtra interações clínicas/financeiras sensíveis;
- traz somente integrantes permitidos;
- converte estados internos em rótulos da interface;
- nunca inclui hashes, tokens, referências secretas ou payloads brutos.

Mutações usam `POST /api/commands` com `{ type, payload, idempotencyKey }`. Cada `type` possui esquema, permissão e SQL próprios; não existe endpoint para substituir o snapshot inteiro. O retorno contém o resultado canônico e um novo bootstrap para manter a tela consistente.

## Decisões de implantação

A sessão baseada em cookie funciona melhor quando web e API aparecem sob a mesma origem pública. Recomenda-se proxy/rewrite de `/api` para o backend, mesmo que os processos sejam hospedados separadamente. Evite depender de cookie de terceiro.

Topologia recomendada para homologação:

```text
https://homolog.smilesync.example
  ├─ /*    → frontend estático
  └─ /api  → API Fastify privada
                  └─ PostgreSQL gerenciado em região próxima
```

Não há deploy realizado nesta branch. A escolha do fornecedor deve considerar backup, restauração, logs, região, contrato de tratamento de dados e custo total, não apenas o plano gratuito.
