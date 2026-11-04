# Segurança, privacidade e LGPD

Este documento é um registro técnico, não parecer jurídico. A clínica que usar o sistema deverá definir, com apoio profissional quando necessário, seu papel de controlador, bases legais, avisos, contratos e prazos de retenção.

## Classificação dos dados

O SmileSync pode tratar dados pessoais e dados pessoais sensíveis de saúde. Por isso, o ambiente de desenvolvimento usa somente pessoas, contatos e eventos fictícios. Não copie prontuários, documentos ou telefones reais para testes.

Categorias previstas:

- identidade e contato de pacientes;
- agenda e relacionamento;
- informações de tratamento, evolução, medicamentos e documentos;
- orçamentos, cobranças e pagamentos;
- dados de usuários, permissões e auditoria;
- consentimentos e eventos de comunicação.

## Controles implementados no código

### Identidade e sessão

- senha armazenada como derivação `scrypt` com salt aleatório;
- token opaco de alta entropia, armazenado apenas como hash;
- cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- validade absoluta e por inatividade no modelo de sessão;
- revogação no logout e após troca de senha;
- conta, associação e clínica precisam estar ativas a cada requisição;
- tokens de recuperação expiram e são de uso único;
- rate limit global e mais restritivo nas rotas de autenticação.

### Aplicação e rede

- CORS aceita somente `APP_ORIGIN`;
- mutações autenticadas recusam origem divergente;
- Helmet adiciona headers de segurança;
- corpo da requisição é limitado;
- validação estrutural e limites de tamanho;
- erros 5xx não devolvem detalhes internos;
- consultas SQL parametrizadas;
- segredos não são enviados ao frontend.

### Tenant e autorização

- `clinic_id` vem da sessão, nunca do corpo da requisição;
- relações relevantes usam chaves compostas por clínica;
- permissões são carregadas do papel persistido;
- cada comando verifica uma permissão no servidor;
- o bootstrap omite dados não autorizados em vez de somente ocultá-los;
- interações são classificadas como operacionais, clínicas ou financeiras antes da persistência;
- a migração PostgreSQL cria RLS para papéis restritos como defesa adicional;
- a credencial privada da API não pode ser compartilhada com browser, BI ou integrações.

### Integridade e rastreabilidade

- históricos de status para agenda, tratamentos e orçamentos;
- `audit_logs` com evento mínimo e sem cópia irrestrita do prontuário;
- auditoria append-only no PostgreSQL endurecido;
- idempotência para operações com risco de duplicidade;
- valores financeiros decimais e alocações transacionais;
- pagamentos anulados mantêm histórico;
- restrições de status, datas, totais e referências no banco;
- exclusão lógica/inativação para entidades que exigem retenção.

## Matriz inicial de acesso

Legenda: `R` leitura, `C` criação, `U` atualização, `X` cancelamento/inativação e `—` sem acesso previsto.

| Área | Administrador | Dentista | Secretária | Recepção | Financeiro |
|---|---|---|---|---|---|
| Pacientes cadastrais | R/C/U/X | R/C/U | R/C/U | R/C/U | R |
| Agenda | R/C/U/X | R/C/U/X | R/C/U/X | R/C/U/X | — |
| Tratamentos gerais | R/C/U | R/C/U | R | — | — |
| Evolução clínica | R/C/U | R/C/U | — | — | — |
| Orçamentos | R/C/U/aprovar | — | — | — | R/C/U/aprovar |
| Financeiro detalhado | R/C/U/anular | — | — | — | R/C/U/anular |
| Equipe e papéis | R/C/U | — | — | — | — |
| Clínica e integrações | R/U | — | — | — | — |
| Automações | R/U | — | — | — | — |
| Exportação operacional | Sim | Sim | Sim | — | — |
| Exportação financeira | Sim | — | — | — | Sim |
| Auditoria | Sim | — | — | — | — |

A matriz é uma decisão inicial e deve ser confirmada pela clínica. Alterar o estado React ou enviar outro papel na requisição não aumenta privilégios.

## WhatsApp e comunicação

O envio real está desativado. Antes de ativá-lo, são obrigatórios:

1. conta oficial na WhatsApp Business Platform;
2. número e empresa verificados conforme exigência vigente do provedor;
3. aceite explícito do paciente, com finalidade/categoria registrada;
4. mecanismo simples de recusa e atendimento humano;
5. modelos aprovados para conversas iniciadas pela clínica;
6. cofre de segredos, rotação e acesso mínimo;
7. verificação de assinatura dos webhooks;
8. deduplicação, tentativas limitadas e registro do status real;
9. revisão do conteúdo para não expor informação de saúde desnecessária;
10. contrato, aviso de privacidade e avaliação da transferência de dados aplicável.

Um rascunho, job agendado ou resposta HTTP aceita não equivale a mensagem entregue.

## Requisitos organizacionais antes de dados reais

- inventário de tratamentos e finalidades;
- definição e documentação das bases legais;
- aviso de privacidade e canais para titulares;
- responsáveis por acesso, suporte, segurança e privacidade;
- política de mínimo privilégio e revisão periódica de acessos;
- contrato com operadores/suboperadores e avaliação de região;
- política de retenção por categoria e bloqueio por obrigação legal;
- procedimento para acesso, correção, portabilidade quando aplicável e eliminação;
- plano de resposta a incidente e avaliação de comunicação à ANPD/titulares;
- treinamento dos usuários contra compartilhamento indevido e phishing;
- plano de continuidade, backup e restauração testada.

As tabelas `data_retention_policies` e `data_erasure_requests` suportam o processo, mas não substituem a governança nem executam eliminação automaticamente.

## Prontidão técnica obrigatória

Não autorizar produção antes de:

- executar migrações e testes em PostgreSQL real de homologação;
- testar tenant isolation com pelo menos duas clínicas e papéis diferentes;
- validar um papel PostgreSQL restrito contra todas as políticas RLS;
- garantir que a conexão da API seja privada, com TLS e sem exposição pública desnecessária;
- configurar cofre/variáveis secretas e rotação;
- definir logs sem corpo clínico, senha, token ou segredo;
- ativar monitoramento, alertas e rate limit distribuído quando houver múltiplas réplicas;
- criar backups automáticos e comprovar uma restauração;
- realizar análise de dependências, SAST e revisão manual;
- corrigir vulnerabilidades críticas/altas;
- testar expiração, revogação, CSRF/origem, enumeração, abuso e falhas de autorização;
- configurar armazenamento privado, URL assinada, checksum, antivírus e expiração antes de documentos;
- separar desenvolvimento, homologação e produção.

## Lacunas conhecidas

- não há MFA;
- recuperação de senha não possui entrega de e-mail configurada;
- rate limit em memória não é suficiente para várias instâncias;
- fila/worker e reprocessamento de automações não estão ativos;
- integração de WhatsApp e verificação de webhook não estão ativas;
- documentos clínicos ainda não possuem storage;
- políticas RLS ainda não foram validadas em PostgreSQL de homologação;
- backup e restauração dependem do fornecedor;
- não houve pentest externo;
- não existe URL pública autorizada.

## Resposta mínima a incidente

1. conter: revogar sessões/credenciais e isolar o componente;
2. preservar: guardar logs e evidências com acesso controlado;
3. avaliar: dados, titulares, período, origem e impacto;
4. corrigir: vulnerabilidade, configurações e acessos;
5. decidir comunicação com responsáveis jurídicos/privacidade;
6. restaurar de estado confiável e monitorar recorrência;
7. registrar lições e ações preventivas.

Nunca inclua dados clínicos completos em tickets, chat, logs de CI ou relatórios de erro.
