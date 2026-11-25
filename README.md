# SmileSync CRM 0.3

CRM odontológico com pacientes, agenda, tratamentos, orçamentos, financeiro e atendimento pelo WhatsApp. Projeto Integrador de Sistemas de Informação do UNIPAM.

## Iniciar no Mac

Com [Node.js](https://nodejs.org/) 22.12 ou superior e npm instalados, execute:

```sh
git clone https://github.com/diegodiasaraujo-ui/SmileSync-CRM.git
cd SmileSync-CRM
npm start
```

Abra [o SmileSync local](http://127.0.0.1:4173/). Também é possível dar dois cliques em **`iniciar.command`** no Finder. O iniciador instala com o lockfile, compila a API e o frontend, aplica as migrações e cria o banco persistente em `apps/api/.data/smilesync`. A primeira instalação precisa de internet. O CRM inicia sem Supabase, Render ou credenciais de WhatsApp.

| Conta de apresentação | Valor |
| --- | --- |
| E-mail | `demo@smilesync.test` |
| Senha | `SmileSyncDemo2026!` |

Entre com essa conta para cadastrar e editar registros que permanecem após fechar e reabrir. Os dados iniciais são fictícios. Em **WhatsApp → Abrir simulação**, as mensagens são fictícias e identificadas na tela. O botão de demonstração sem login continua disponível para explorar a interface.

Mantenha o terminal aberto. Encerre com `Ctrl+C`. Se outra prévia estiver usando a porta, execute `SMILESYNC_PORT=4175 npm start` e abra `http://127.0.0.1:4175/`. Para uma base sem os dados iniciais, use `SMILESYNC_SEED_DEMO=false` com um novo `SMILESYNC_DATA_DIR` e crie a sua conta. Preserve a pasta do banco ao atualizar o código.

## Conectar o WhatsApp real

O caminho de apresentação usa o canal **WhatsApp Web** da Z-API Omni. Copie `.env.example` para `.env` na raiz, preencha `OMNI_CHANNEL_ID` e `OMNI_SECRET_KEY` e reinicie com `npm start`. Coloque apenas a Secret Key da API nesse campo. O `.env` fica fora do Git. Use somente o número de outro contato autorizado para envio.

Para receber mensagens e atualizações de entrega no Mac, siga [Z-API Omni e webhook HTTPS](docs/OMNI.md). A API da Meta continua documentada em [WhatsApp Cloud API](docs/WHATSAPP.md). Nenhum provedor externo é necessário para usar os demais módulos.

## Código e dados

`apps/web` contém a interface React, `apps/api` a API Fastify e `apps/api/migrations` o esquema versionado. As telas usam a mesma origem e `/api`. O banco local, o `.env`, as dependências instaladas e o build ficam fora do repositório. Os HTMLs na raiz são a versão histórica e não iniciam o CRM.

[Arquitetura](docs/ARCHITECTURE.md) · [Segurança e dados](docs/SECURITY_AND_LGPD.md)
