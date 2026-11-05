Codespaces: Rebuild Container.# SmileSync

CRM odontológico para organizar pacientes, agenda, tratamentos, orçamentos e controle financeiro em uma única operação. O projeto é o Projeto Integrador do 2º período de Sistemas de Informação do UNIPAM.

## Abrir para a apresentação

Não abra os arquivos `.html` da raiz com duplo clique: eles pertencem à versão
antiga preservada da equipe. A aplicação integrada precisa iniciar o frontend e
a API juntos.

### Opção mais simples

1. Instale [Node.js 22 LTS](https://nodejs.org/) (`22.12` ou superior).
2. Extraia o ZIP inteiro.
3. No macOS, dê duplo clique em `INICIAR_SMILESYNC.command`.
4. No Windows, dê duplo clique em `INICIAR_SMILESYNC.bat`.
5. Aguarde a página `http://127.0.0.1:4173` abrir.

Na primeira execução, o iniciador instala as dependências. O banco PGlite local
é criado em `apps/api/.data/` e as migrações são aplicadas automaticamente.
Nenhum PostgreSQL externo, chave ou arquivo `.env` é necessário para a
demonstração local. É necessário acesso à internet apenas na primeira instalação
das dependências.

### Pelo terminal do VS Code

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm start
```

Se `pnpm` já estiver instalado, execute os mesmos comandos sem o prefixo
`corepack`. Acesse `http://127.0.0.1:4173`, crie uma conta local ou use
**Explorar demonstração sem login**. Encerre com `Ctrl+C`.

Se a página mostrar `ERR_CONNECTION_REFUSED`, o servidor não está rodando:
execute novamente o iniciador. Se a porta estiver ocupada, encerre a execução
anterior com `Ctrl+C`.

## Estado atual

Esta branch integra a interface React exportada do Figma Make a uma API TypeScript e a um banco relacional. Ela é uma base funcional de desenvolvimento, ainda não uma liberação para dados clínicos reais.

| Situação | Escopo |
|---|---|
| Implementado e testado localmente | Aplicação React preservada; sessão por cookie; cadastro, login, logout e recuperação sem entrega externa; esquema multi-clínica; migrações; bootstrap autenticado; comandos persistentes de pacientes, agenda, tratamentos, orçamentos, financeiro e configurações; autorização por função; isolamento entre clínicas; idempotência; modo demonstração isolado |
| Preparado, não ativo | Estruturas de consentimento, mensagens, automações, webhooks, auditoria e endurecimento PostgreSQL |
| Bloqueado por configuração/autorização | E-mail transacional, WhatsApp Business Platform, armazenamento de documentos clínicos e publicação de homologação/produção |

O envio de WhatsApp está deliberadamente desativado. A interface salva somente rascunhos e não declara uma mensagem como enviada ou entregue.

## Arquitetura

```text
Navegador
  └─ apps/web · React 19 + TypeScript + Vite + Tailwind CSS
          │  HTTPS/JSON + cookie HttpOnly
          ▼
     apps/api · Fastify + TypeScript + Zod
          │  SQL parametrizado e transações
          ▼
     PostgreSQL
       ├─ PGlite apenas para desenvolvimento/testes locais
       └─ PostgreSQL gerenciado para homologação/produção
```

A versão HTML/CSS/JavaScript original do GitHub permanece na raiz para preservar o trabalho e o histórico da equipe. O produto integrado está em `apps/`:

- `apps/web`: frontend React recuperado do ZIP do Figma Make;
- `apps/api`: autenticação, API, regras de negócio e acesso ao banco;
- `apps/api/migrations`: esquema base e endurecimento específico do PostgreSQL;
- `docs`: auditoria, arquitetura, segurança/LGPD e disponibilização.

As decisões e limitações estão detalhadas em:

- [Auditoria das fontes](docs/AUDIT.md)
- [Arquitetura e modelo de dados](docs/ARCHITECTURE.md)
- [Segurança e LGPD](docs/SECURITY_AND_LGPD.md)
- [Disponibilização e operação](docs/DEPLOYMENT.md)

## Pré-requisitos

- Node.js `>= 22.12`;
- pnpm `11.25.0`;
- macOS, Linux ou Windows com ambiente compatível com Node;
- PostgreSQL somente para validar homologação/produção. O desenvolvimento local pode usar PGlite.

O arquivo `.mise.toml` fixa as versões recomendadas para quem utiliza [mise](https://mise.jdx.dev/).

## Instalação e execução local

```bash
pnpm install
pnpm dev
```

Por padrão:

- frontend: `http://127.0.0.1:4173`;
- API: `http://127.0.0.1:3001`;
- banco local persistente: `apps/api/.data/smilesync` quando o script da API é executado no diretório do pacote.

O Vite encaminha `/api` para a API durante o desenvolvimento. A API aplica as migrações automaticamente fora de produção. Para executá-las explicitamente:

```bash
pnpm --filter @smilesync/api migrate
```

Os valores padrão permitem a execução local sem segredo. Para sobrescrevê-los, exporte as variáveis no processo que inicia a API; `.env.example` é somente um modelo e nunca deve receber credenciais reais no Git.

```bash
export DATABASE_URL='pglite://./.data/smilesync'
export APP_ORIGIN='http://127.0.0.1:4173'
pnpm dev
```

## Variáveis da API

| Variável | Uso | Produção |
|---|---|---|
| `NODE_ENV` | `development`, `test` ou `production` | `production` |
| `HOST` / `PORT` | Endereço de escuta da API | Definido pela plataforma |
| `APP_ORIGIN` | Origem exata aceita por CORS e proteção de mutações | Obrigatória, HTTPS |
| `DATABASE_URL` | `pglite://...` local ou conexão `postgresql://...` | PostgreSQL obrigatório |
| `MIGRATE_ON_START` | Aplicar migrações na inicialização | Preferir `false` e etapa controlada |
| `SESSION_TTL_DAYS` | Validade máxima da sessão | 1 a 90 dias |
| `PASSWORD_RESET_TTL_MINUTES` | Validade do token de recuperação | 5 a 120 minutos |
| `COOKIE_NAME` | Nome do cookie opaco | Nome exclusivo do ambiente |
| `EXPOSE_TEST_RESET_TOKENS` | Retornar token em testes automatizados | Sempre `false` |

## Qualidade

Execute antes de abrir Pull Request:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Os testes da API usam PostgreSQL embutido em memória e dados fictícios. A validação em PostgreSQL real, inclusive das políticas RLS, é uma condição separada para homologação. Consulte [Disponibilização](docs/DEPLOYMENT.md).

Na validação local desta entrega, migrações PGlite, verificação de tipos, 14 testes de integração e build de produção passaram. A suíte cobre autenticação e revogação, proteção de origem, persistência após novo login, conflito de agenda, fluxo tratamento–orçamento–parcelamento–pagamento, validações, repetição idempotente inclusive concorrente, classificação de interações sensíveis, autorização financeira e isolamento entre duas clínicas. O workflow equivalente está versionado em `.github/workflows/ci.yml`, mas ainda não foi executado remotamente nesta branch.

## Regras de segurança essenciais

- dados são sempre associados a uma clínica (`clinic_id`);
- a sessão usa token aleatório opaco em cookie `HttpOnly`; somente o hash é armazenado;
- senhas usam `scrypt` com salt e comparação resistente a timing;
- permissões são carregadas do banco e verificadas no servidor;
- mutações com cookie exigem a origem configurada;
- consultas utilizam parâmetros SQL;
- operações sensíveis possuem trilha de auditoria e chaves de idempotência no modelo;
- valores financeiros são armazenados como `numeric(14,2)` e processados transacionalmente;
- nenhum segredo administrativo pertence ao frontend.

Não use dados pessoais ou clínicos reais até concluir a lista de prontidão em [Segurança e LGPD](docs/SECURITY_AND_LGPD.md).

## Limitações conhecidas

- o provedor de e-mail não está configurado; a recuperação registra tokens, mas não entrega mensagens;
- o convite de equipe é registrado com segurança, porém o envio e o fluxo de aceite/ativação pelo convidado ainda não estão implementados;
- a integração oficial do WhatsApp, os modelos aprovados e os webhooks não estão configurados;
- o executor de automações/filas ainda não está em operação;
- upload, antivírus e armazenamento privado de documentos clínicos ainda não estão implementados;
- não há deploy autorizado nem URL pública;
- a migração de endurecimento, os triggers e as políticas RLS ainda exigem execução e validação em PostgreSQL gerenciado de homologação;
- paginação e exportação server-side para grandes volumes permanecem como evolução;
- backup, restauração e resposta a incidentes dependem da infraestrutura escolhida.

## Git

O desenvolvimento integrado ocorre na branch `codex/smilesync-fullstack`. A branch `main` e o histórico da implementação original não foram sobrescritos. Push, merge, Pull Request e deploy dependem de autorização explícita.

## Licença e uso

Não há licença de distribuição definida no repositório. Até que a equipe escolha uma licença, trate o código como material acadêmico do projeto SmileSync e não o redistribua como software licenciado.
