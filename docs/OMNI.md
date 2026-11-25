# WhatsApp com Z-API Omni

1. Confirme no [painel Omni](https://app.omni.z-api.io/) que o canal WhatsApp Web está conectado. Crie o `.env` na raiz a partir de [`.env.example`](../.env.example) e preencha `OMNI_CHANNEL_ID` e `OMNI_SECRET_KEY` com os valores do canal e da **Secret Key** gerada em **Segurança**. A Public Key do SDK e o token de compatibilidade do canal não são usados. [Autenticação Omni](https://developer.omni.z-api.io/authentication)
2. Inicie o CRM com `npm start` e faça login. A clínica demo é selecionada pelo iniciador quando `WHATSAPP_CLINIC_ID` está vazio. Para vincular outra clínica, defina o UUID dela em `WHATSAPP_CLINIC_ID`. O inbox exibe o estado consultado na Omni.
3. Na aba **WhatsApp**, selecione um paciente de teste com outro número autorizado. A API recebe `recipient.identifier` com DDI, DDD e número sem pontuação, `content.type` igual a `TEXT` e o texto em `content.body.message`. O `messageId` de um HTTP 200 indica aceite. Envio, entrega e falha são atualizados por eventos. [Contrato de envio](https://developer.omni.z-api.io/messages/send-text)

## Receber mensagens e status no Mac

Instale apenas para esta etapa a [ferramenta oficial `cloudflared`](https://developers.cloudflare.com/tunnel/downloads/). Deixe o CRM aberto com `npm start` e, em outro terminal na raiz do projeto, execute:

```sh
npm run omni:webhook -- --tunnel
```

O comando imprime `https://<endereço>.trycloudflare.com/api/whatsapp/omni/webhook`. O túnel aponta para um gateway local que só encaminha **POST** nesse caminho. A API valida a assinatura antes de persistir o evento. A interface, o login e o banco continuam locais. [Túnel temporário](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) · [Assinatura Omni](https://developer.omni.z-api.io/webhooks/signature)

Em um terceiro terminal, substitua o endereço pelo que apareceu e rode:

```sh
npm run omni:register -- 'https://<endereço>.trycloudflare.com/api/whatsapp/omni/webhook'
```

O comando cadastra o webhook assinado em formato `DEFAULT` com `MESSAGE_RECEIVED`, `MESSAGE_DELIVERY` e `MESSAGE_STATUS`, salva o ID e o segredo somente no `.env` e não imprime credenciais. Reinicie o CRM após o primeiro cadastro. Se o hostname do túnel mudar, rode o cadastro com o novo endereço para atualizar o mesmo webhook. É possível fazer o cadastro pelo [painel Omni](https://app.omni.z-api.io/) se ele oferecer assinatura HMAC e o segredo correspondente. [Cadastro oficial](https://developer.omni.z-api.io/webhooks/create-webhook)

## Como interpretar o teste anterior

O HTTP 200 e o painel em “Aguardando entrega” confirmam que a Omni aceitou a requisição. Eles não confirmam entrega no WhatsApp. O teste usou o próprio número conectado e incluiu formatação, enquanto a referência envia somente dígitos. Para eliminar esses fatores, use um destinatário diferente e autorizado, no formato `55DDDNÚMERO`, e confira o evento de entrega. Uma chave inválida ou ausente é uma causa documentada de `401`; sem inspecionar a autenticação do Playground não dá para atribuir o motivo exato. [API de texto](https://developer.omni.z-api.io/messages/send-text) · [Eventos](https://developer.omni.z-api.io/webhooks/channel-webhooks)

O fallback de apresentação em **Abrir simulação** não utiliza a Omni e não envia mensagens externas. A integração por QR Code é o modo WhatsApp Web da Omni e depende da sessão do canal e da vigência do teste. [Canal WhatsApp Web](https://developer.omni.z-api.io/connect/whatsapp-web)
