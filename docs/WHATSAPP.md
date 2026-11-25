# WhatsApp Cloud API no SmileSync

O navegador envia requisições para a API Fastify com o login normal do SmileSync. O backend grava o histórico no PostgreSQL e chama a Graph API da Meta. A Meta envia novos textos e mudanças de status ao webhook, via HTTPS. O SmileSync associa o contato a um paciente ativo quando encontra uma correspondência única pelo telefone internacional. A agenda utiliza a mesma tabela `appointments` do restante do CRM.

O pacote atual conecta um número e uma clínica por instância. Use um número de teste da Meta e pacientes fictícios no primeiro ensaio. Para atendimentos reais, configure o opt-in, respeite pedidos de descadastro e deixe a equipe disponível para assumir a conversa. [Política do WhatsApp Business](https://whatsappbusiness.com/policy/)

## 1. Publicar API e frontend na mesma origem

O painel usa caminhos relativos `/api/...` e cookie de sessão. Um único Web Service no Render pode servir o frontend compilado e a API. Disponibilize a versão desta pasta no repositório conectado ao Render e selecione essa branch no serviço. Deixe o **Root Directory** na raiz que contém o `pnpm-workspace.yaml`.

| Configuração no Render | Valor |
| --- | --- |
| Runtime | Node |
| Build Command | `npx --yes pnpm@11.25.0 install --frozen-lockfile --prod=false && npx --yes pnpm@11.25.0 build` |
| Pre-Deploy Command, quando disponível | `node apps/api/dist/cli/migrate.js` |
| Start Command | `node apps/api/dist/server.js` |
| Health Check Path | `/api/health` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `APP_ORIGIN` | `https://<seu-servico>.onrender.com`, sem barra final |
| `SMILESYNC_WEB_DIST` | `apps/web/dist` |
| `DATABASE_URL` | Conexão PostgreSQL do Supabase com TLS, apenas no backend |
| `MIGRATE_ON_START` | `false` com migração separada. Em homologação com uma única instância e sem pre-deploy, `true` na primeira inicialização do banco novo. |

No Supabase, abra **Connect** e copie a conexão de **Session pooler** quando o servidor precisar de IPv4. Se o serviço e a rede suportarem a conexão direta, ela também pode ser usada. Configure `DATABASE_URL` no ambiente do Render, com TLS e a senha inserida no lugar do marcador. Guarde a senha fora do Git. A Data API do Supabase e o Supabase Auth são independentes desse fluxo. [Conexão PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Deploy no Render](https://render.com/docs/deploys)

Para banco novo, o migrador aplica os arquivos SQL numerados em sequência. Para um banco existente, faça backup e consulte `public.schema_migrations` antes de qualquer deploy. Se o esquema foi instalado pelo SQL Editor e essa tabela não existe ou não registra as versões anteriores, revise as versões já instaladas em uma cópia de homologação antes de rodar o migrador. O processo padrão tentará aplicar os scripts que não constam no histórico e poderá parar por objetos já existentes. A rota `https://<seu-servico>.onrender.com/api/health` deve retornar `{"status":"ok"}`.

## 2. Você precisa autorizar no painel da Meta

1. Acesse **Meta for Developers → Meus Apps** e crie ou abra um app com o caso de uso **Conectar-se com clientes pelo WhatsApp**. Anote o **App ID** para identificar o app no painel. O App ID não é consumido pelo código.
2. Em **WhatsApp → API Setup**, selecione a conta (WABA) e o número. Para o primeiro teste, adicione e verifique um número pessoal de teste como destinatário no painel da Meta. Copie o **WhatsApp Business Account ID** e o **Phone Number ID**. O segundo é um identificador da Meta, diferente do número de telefone.
3. Em **App Settings → Basic**, obtenha o **App Secret**. Gere um segredo aleatório independente para o **Verify Token** (por exemplo, `openssl rand -hex 32`).
4. Use o access token temporário da Meta para o ensaio. Para operar continuamente, crie um usuário de sistema no portfólio empresarial, conceda acesso ao app e à WABA, e gere o token com `whatsapp_business_messaging` (envio) e `whatsapp_business_management` (consulta de modelos e gerenciamento da conta/assinatura). Use o escopo exigido pela Meta para os ativos da sua conta. Para servir contas de terceiros, siga o processo aplicável de App Review e acesso avançado.
5. Cadastre ou confirme o usuário administrador do SmileSync e identifique a clínica correta no **Table Editor → clinics** do Supabase. Use o `id` dessa clínica. Obtenha o valor pelo painel administrativo e mantenha todos os segredos no ambiente do backend.

[Início rápido da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) · [App Review](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission/)

| Variável | Valor |
| --- | --- |
| `WHATSAPP_CLINIC_ID` | ID da clínica no PostgreSQL |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID |
| `WHATSAPP_GRAPH_API_VERSION` | Versão Graph suportada no app, por exemplo `v27.0` |
| `WHATSAPP_ACCESS_TOKEN` | Token da Cloud API |
| `WHATSAPP_APP_SECRET` | App Secret usado no HMAC do webhook |
| `WHATSAPP_VERIFY_TOKEN` | Segredo independente, igual no Render e no cadastro do webhook |

## 3. Ativar o webhook

1. Com as variáveis configuradas, reinicie o serviço. No app da Meta, em **WhatsApp → Configuration → Webhooks**, use `https://<seu-servico>.onrender.com/api/whatsapp/webhook` como **Callback URL** e o mesmo `WHATSAPP_VERIFY_TOKEN` como **Verify token**. Salve para a Meta verificar o endpoint GET.
2. Assine o campo **`messages`** do objeto **`whatsapp_business_account`**. Confirme também a inscrição do app na WABA no painel ou pelo endpoint oficial `POST /{WABA_ID}/subscribed_apps` com um token autorizado para a conta.
3. No SmileSync, abra **WhatsApp**. O perfil Administrador tem `whatsapp.inbox.read` para consultar e `whatsapp.inbox.send` para enviar. Para liberar o atendimento a outro papel, use o Table Editor do Supabase para inserir essas permissões em `role_permissions` com `clinic_id`, o `role_id` do papel da mesma clínica e o `permission_code` escolhido. Quem só precisa acompanhar conversas deve receber apenas leitura. A conversa começa com uma mensagem do contato. Mensagens livres ficam disponíveis dentro de 24 horas da última mensagem do contato.
4. Fora da janela, use um modelo utilitário aprovado e sem parâmetros, botões ou mídia. Cadastre e aprove os modelos no WhatsApp Manager da Meta. Registre o opt-in comprovado no **Table Editor → patient_consents** para o paciente associado, com `channel=whatsapp`, `purpose=whatsapp_utility`, `status=granted`, a origem da evidência em `evidence_source` e a data real em `recorded_at`. Para retirar o consentimento, registre o evento mais recente com `status=revoked` e `revoked_at`. Mantenha a evidência de opt-in fora dos logs. Um pedido de descadastro reconhecido na conversa bloqueia envios.

O webhook compara `X-Hub-Signature-256` com o HMAC-SHA256 calculado sobre o corpo recebido. Mensagens e status entram pelo mesmo campo da assinatura. [Configuração de webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/) · [Webhooks do WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) · [Modelos de mensagem](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/)

O inbox registra textos e informa o tipo de mensagens com mídia, sem baixar anexos. A associação ao cadastro usa o telefone. Contas que fornecem somente o identificador alternativo da Meta (BSUID) ainda estão fora deste fluxo.

## 4. Configurar os serviços de agendamento

1. No **Table Editor** do Supabase, consulte `clinic_memberships`, `professionals` e `clinic_resources`. Use registros ativos da mesma clínica. Escolha uma associação de funcionário ativa cujo papel permita `appointments.create`, um profissional e uma sala ativa vinculada a uma unidade ativa. Se o banco ainda não tiver profissionais ou salas, configure os mesmos registros usados na agenda antes de continuar.
2. Em `whatsapp_booking_settings`, insira `clinic_id`, `actor_membership_id`, `enabled=true`, `working_days`, `opens_at` e `closes_at`. Os dias são números de `1` (segunda) a `7` (domingo). Exemplo de segunda a sexta em SQL: `ARRAY[1,2,3,4,5]::smallint[]`. Escolha o horário real da clínica, dentro da janela da agenda atual (`08:00` a `18:00`). O fuso vem de `clinics.timezone`.
3. Em `whatsapp_booking_services`, insira um registro por serviço com `clinic_id`, `name`, `aliases` (variações do nome que o paciente pode usar), `duration_minutes`, `professional_id`, `resource_id` e `active=true`. Cadastre somente os serviços, durações e recursos que podem de fato ser reservados.
4. No ambiente da API, defina `WHATSAPP_SCHEDULING_ENABLED=true` e reinicie o serviço. Com o número já associado a um único paciente ativo, o atendimento interpreta pedidos de agendamento em português, pergunta por dados faltantes e propõe horários válidos. Pacientes sem vínculo devem ser atendidos pela equipe. A proposta vale 15 minutos e só vira consulta quando o contato responde `CONFIRMAR <código>` e o horário segue livre.

A interpretação local vem habilitada junto com o agendamento. Para experimentar o modelo externo, defina também `WHATSAPP_BOOKING_OPENAI_ENABLED=true`, `WHATSAPP_BOOKING_OPENAI_MODEL` (um modelo da Responses API com Structured Outputs) e `OPENAI_API_KEY` no backend. O código envia apenas termos reconhecidos do pedido, o catálogo pertinente e o contexto de data/fuso. O modelo sugere citações, e a API valida as evidências e a disponibilidade. `store: false` limita o armazenamento de estado da resposta. Consulte os controles de retenção da organização antes de habilitar o serviço com mensagens reais. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) · [Controles de dados](https://developers.openai.com/api/docs/guides/your-data)

## 5. Ensaiar com dados fictícios

1. Cadastre um paciente com o número do celular de teste. Envie um texto desse celular para o número da Meta. Confira a associação, o histórico e a indicação de mensagem aguardando resposta na tela WhatsApp.
2. Responda pelo SmileSync. Confira o texto no celular e o histórico de status no CRM. O primeiro retorno da API indica aceitação pela Meta. Entrega e leitura chegam depois pelo webhook e dependem das configurações do destinatário.
3. Com o agendamento habilitado e um serviço configurado, envie um pedido com serviço, data e hora livres. Confira que a agenda segue vazia até o paciente devolver o código de confirmação. Após o código, abra **Agenda** e confirme a consulta. Repita o mesmo código e confira que não foi criado outro registro. Repita em um horário ocupado para testar a rejeição.

Para rodar a aplicação local sem conectar a Meta, execute `pnpm install --frozen-lockfile` e `pnpm dev` na raiz. Abra `http://127.0.0.1:4173`. Para ler variáveis de `apps/api/.env` no desenvolvimento, inicie a API com `pnpm --filter @smilesync/api exec node --env-file=.env --import tsx src/server.ts` e o frontend, em outro terminal, com `pnpm --filter @smilesync/web dev`. A verificação pela Meta exige uma origem HTTPS pública e não alcança `localhost` por conta própria.

Use `pnpm validate` para checar tipos, testes e build. Os testes usam banco local em memória e respostas injetadas para o provedor. Execute o ensaio acima para validar uma conta real e a configuração do Render.
