# Disponibilização, operação e manutenção

## Situação

Não existe deploy autorizado nem URL pública desta branch. Este documento descreve o caminho de homologação; executá-lo exige conta, infraestrutura, segredos por canal seguro e autorização do responsável.

## Topologia recomendada

- frontend estático construído de `apps/web`;
- API Node/Fastify construída de `apps/api`;
- PostgreSQL gerenciado com TLS, backup e região compatível com a avaliação de privacidade;
- proxy público único: aplicação em `/*` e API em `/api/*`;
- banco acessível apenas pela API, migração e administração autorizada;
- worker separado no futuro para jobs e webhooks.

Manter web e API sob a mesma origem simplifica cookies seguros e evita dependência de cookies de terceiros. Se forem usados domínios diferentes, cookies, CORS, CSRF/origem e proxy precisam de novo desenho e teste.

## Artefatos

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Saídas esperadas:

- frontend: `apps/web/dist`;
- API: `apps/api/dist`;
- migrações: `apps/api/migrations` devem acompanhar a release.

O processo da API é iniciado por:

```bash
pnpm --filter @smilesync/api start
```

O frontend deve ser servido por CDN/servidor estático com fallback de SPA para `index.html`. Requisições `/api` precisam ser encaminhadas sem remover cookies ou headers de origem.

## Variáveis de produção

Exemplo sem valores reais:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=<fornecido pela plataforma>
APP_ORIGIN=https://<origem-exata>
DATABASE_URL=postgresql://<usuario>:<segredo>@<host>:5432/<banco>?sslmode=require
MIGRATE_ON_START=false
SESSION_TTL_DAYS=7
PASSWORD_RESET_TTL_MINUTES=30
COOKIE_NAME=smilesync_session
EXPOSE_TEST_RESET_TOKENS=false
```

Regras:

- usar painel/cofre do provedor, nunca arquivo commitado;
- credenciais diferentes por ambiente;
- usuário da aplicação sem superusuário e sem acesso a outros bancos;
- usuário de migração separado quando a plataforma permitir;
- rotação após exposição suspeita ou saída de responsável;
- nunca inserir token de WhatsApp, senha ou `DATABASE_URL` no frontend.

## Banco e migrações

1. criar banco de homologação vazio;
2. restringir rede e exigir TLS;
3. executar backup/snapshot antes de atualizar ambiente existente;
4. definir `DATABASE_URL` somente no processo de migração;
5. executar `pnpm --filter @smilesync/api migrate` uma vez;
6. verificar `schema_migrations`;
7. iniciar a API com `MIGRATE_ON_START=false`;
8. testar o health check e os fluxos críticos;
9. somente então promover a mesma revisão para produção.

`001_initial.sql` cria o modelo base. `002_postgres_hardening.sql` depende de PostgreSQL real e adiciona extensões/triggers/RLS; PGlite a ignora deliberadamente. A API usa conexão privada do proprietário do esquema e filtros explícitos. Papéis secundários devem ser sem `BYPASSRLS` e precisam ser testados contra as políticas antes do uso.

Não edite uma migração já aplicada em ambiente compartilhado; crie uma nova migração incremental.

## Gate de homologação

Todos os itens devem ser evidenciados:

- `pnpm typecheck`, `pnpm test`, `pnpm build` e formatação aprovados;
- cadastro, login, recarga, logout e novo login;
- recuperação com provedor de e-mail de homologação, sem expor token;
- paciente, consulta, conflito de agenda, tratamento e etapas;
- orçamento, aprovação, conversão única, parcelamento e pagamento;
- rejeição de sobrepagamento e repetição idempotente;
- permissões de todos os papéis;
- duas clínicas tentando acessar IDs uma da outra;
- sessão/associação desativada;
- exportação respeitando filtros e permissão;
- rascunho de mensagem sem envio quando integração não estiver ativa;
- navegação desktop e móvel;
- logs sem senha, token, mensagem ou prontuário;
- backup e restauração ensaiada.

O repositório já contém `.github/workflows/ci.yml` para instalar com lockfile congelado e executar typecheck, testes e build em pull requests e pushes na `main`. A validação local passou, mas a execução do workflow no GitHub ainda depende de push/PR autorizado; checks obrigatórios e proteção da branch também ainda precisam ser configurados.

## Health, observabilidade e alertas

`GET /api/health` verifica conectividade básica do banco e retorna `{ "status": "ok" }`.

Em operação, adicionar:

- probe de disponibilidade da API e do frontend;
- métricas de latência, taxa de erro e saturação do pool;
- alertas de falha de login anormal, 5xx, fila parada e webhook inválido;
- logs estruturados com `requestId`, clínica/usuário apenas por identificador quando necessário;
- retenção mínima e acesso controlado;
- mascaramento de e-mail/telefone quando não essenciais;
- monitoramento de banco, disco, conexões e idade do backup.

Não registrar bodies de autenticação, cookies, tokens, evoluções clínicas, documentos ou texto integral de mensagens.

## Backup e recuperação

Para produção, selecionar plano com backup automático e retenção compatível. Definir:

- RPO: perda máxima aceitável de dados;
- RTO: tempo máximo para restaurar o serviço;
- retenção e cópia em região/conta apropriada;
- responsável por autorizar restauração;
- teste periódico em ambiente isolado;
- validação de integridade e das migrações após restauração.

Backup não testado não é evidência de recuperabilidade.

## Rollback

Código:

1. manter a imagem/artefato anterior;
2. interromper novas mutações se houver risco de corrupção;
3. reverter o tráfego para a revisão anterior;
4. validar health e fluxos de leitura;
5. investigar usando logs e `requestId`.

Banco:

- migrações devem preferir mudanças retrocompatíveis em duas etapas;
- não executar `DROP`, truncamento ou reversão destrutiva automaticamente;
- para corrupção, restaurar snapshot validado conforme RPO/RTO;
- documentar qualquer reparo e preservar auditoria.

## Integrações externas

### E-mail

Selecionar provedor, configurar domínio/remetente, templates, bounce e rate limit. Enquanto isso, recuperação e convites devem declarar `not_configured`, sem afirmar entrega.

### WhatsApp

Ativar somente com conta oficial, consentimento, modelos aprovados, segredos no cofre e webhook assinado. Começar em número/ambiente de teste, com dados fictícios. Custos são variáveis e precisam ser confirmados no momento da contratação.

### Documentos clínicos

Antes de liberar upload: bucket privado, criptografia, autorização tenant-scoped, URLs curtas assinadas, limite de tipo/tamanho, nome aleatório, checksum, antivírus, auditoria e política de retenção.

## Manutenção rotineira

- revisar dependências e avisos de segurança mensalmente;
- testar restore e acesso de emergência no intervalo definido pela equipe;
- revisar membros/papéis e sessões ativas;
- acompanhar migrações e espaço do banco;
- revisar falhas de automação/webhook quando estes forem ativados;
- remover logs expirados conforme política;
- manter runbook e contatos de incidente atualizados;
- executar validação completa antes de cada release.

## Estimativa inicial de custo

Referência consultada em 4 de novembro de 2026; preços podem mudar e devem ser
revalidados antes de qualquer contratação:

- desenvolvimento acadêmico pode permanecer sem custo com PGlite local;
- [Supabase Free](https://supabase.com/pricing) custa US$ 0, mas pausa projetos
  inativos e não inclui backup automático, portanto não é a recomendação para
  dados clínicos reais;
- [Supabase Pro](https://supabase.com/pricing) parte de US$ 25/mês para um
  projeto, antes de excedentes e adicionais;
- [Vercel Pro](https://vercel.com/pricing) custa US$ 20/mês, antes de excedentes
  e impostos. O plano Hobby é voltado a projetos pessoais/não comerciais;
- a combinação Vercel Pro + Supabase Pro parte, portanto, de US$ 45/mês. Esta
  conta pressupõe adaptar a API Fastify ao runtime escolhido ou contratar um
  serviço Node separado, cujo custo deve ser somado;
- domínio, e-mail transacional, observabilidade, armazenamento e WhatsApp não
  estão incluídos. O WhatsApp tem cobrança variável por tipo de mensagem,
  país e provedor.

Nenhum serviço pago foi contratado ou ativado nesta branch.

## Dependências restantes para publicação

1. autorização de deploy;
2. escolha/criação dos ambientes;
3. domínio e HTTPS;
4. PostgreSQL de homologação e produção;
5. canal seguro para segredos;
6. executar remotamente o workflow de CI já versionado e configurar checks obrigatórios/proteção de branch;
7. validação completa em homologação;
8. backup/restauração e observabilidade;
9. aprovação de segurança, privacidade e regras de negócio.
