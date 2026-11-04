# Auditoria das fontes do SmileSync

Data da auditoria: 4 de novembro de 2026.

## Materiais examinados

1. ZIP `SmileSync (cópia).zip`, exportado do Figma Make e preservado separadamente como fonte recuperada;
2. repositório oficial `diegodiasaraujo-ui/SmileSync`, branch `main`, preservado neste clone;
3. aplicação integrada criada na branch isolada `codex/smilesync-fullstack`.

Nenhum arquivo da branch remota `main` foi sobrescrito, enviado ou mesclado. A implementação HTML original continua na raiz; o React e a API foram adicionados em `apps/`.

## Inventário comparativo

| Área | React recuperado do Figma Make | GitHub `main` |
|---|---|---|
| Base técnica | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router | HTML, CSS e JavaScript sem backend |
| Dashboard | Indicadores, ações rápidas, estados visuais e navegação | Dashboard estático |
| Pacientes | Lista, filtros, perfil, histórico, formulários e relatórios | Páginas e formulários parciais |
| Agenda | Visões, remarcação, status, filtros e modais | Página estática/parcial |
| Tratamentos | Lista, detalhes, etapas, prioridade e acompanhamento | Página parcial |
| Orçamentos | Criação, status, detalhe, conversão e relatório | Página parcial |
| Financeiro | Parcelas, pagamentos, filtros, calendário e relatório | Implementação estática mais recente da `main` |
| Configurações | Conta, clínica, equipe, permissões visuais, preferências e automações | Cobertura menor |
| Persistência/autorização | `localStorage` e papéis simulados na origem | autenticação simulada; sem servidor |

Conclusão: a versão React tem a maior cobertura funcional e foi escolhida como interface principal. A versão GitHub foi mantida como registro do trabalho anterior e referência visual, não como runtime paralelo do produto integrado.

## Problemas confirmados na fonte React

- `localStorage` era a fonte primária de registros clínicos e financeiros;
- login, cadastro, recuperação e logout eram demonstrativos;
- o navegador podia trocar o papel do usuário;
- profissionais e salas eram listas fixas;
- diversas datas partiam do dia demonstrativo `2026-09-16`;
- o link de WhatsApp preparava texto sem confirmação de entrega;
- não havia banco, API, tenant, trilha de auditoria ou idempotência;
- uma atualização de estado e seu histórico podiam ocorrer separadamente;
- valores financeiros eram mantidos somente como `number` no navegador;
- a função de busca de paciente podia mascarar identificadores inválidos retornando o primeiro registro.

## Problemas confirmados no GitHub `main`

- referências misturavam `assets/CSS` e `assets/css`, falhando em sistemas sensíveis a maiúsculas;
- login e autorização eram simulados no cliente;
- formulários e botões não possuíam processamento persistente completo;
- a entrada Git `SmileSync` estava registrada como gitlink sem `.gitmodules` e sem URL recuperável;
- o README ainda descrevia tecnologias como “em definição”;
- módulos não formavam uma aplicação de ponta a ponta.

## Reutilização efetiva

Foram preservados do React:

- identidade visual, tema, tipografia e responsividade;
- estrutura de navegação e nomes obrigatórios dos módulos;
- Dashboard e seus componentes;
- tabelas, painéis, modais, formulários, feedbacks e estados vazios;
- fluxos de Pacientes, Agenda, Pacientes em Tratamentos, Orçamentos, Controle financeiro e Configurações;
- CSV e impressão dentro dos módulos;
- dados fictícios, exclusivamente no modo de demonstração explicitamente identificado.

Foram substituídos ou isolados:

- `localStorage` por API/banco para sessões autenticadas;
- autenticação simulada por sessão opaca real;
- seleção de papel por permissões originadas no servidor;
- profissionais fixos por integrantes da clínica;
- ação de WhatsApp por rascunho interno com envio desativado;
- mutações de snapshot por comandos validados e específicos;
- data demonstrativa fixa por data calculada no fuso inicial da clínica.

## Verificações realizadas durante a auditoria inicial

Antes da integração, a fonte React teve dependências instaladas e passou por verificação de tipos e build. O servidor Vite foi aberto no navegador e as rotas principais — login, Dashboard, Pacientes, Agenda, Tratamentos, Orçamentos, Controle financeiro e Configurações — foram percorridas sem erro de console observado naquele baseline.

Esses resultados não substituem a regressão da versão integrada. Os comandos atuais de validação estão no README, e o resultado final deve ser registrado na entrega/PR depois que todos forem executados sobre o código consolidado.

## Itens que continuam fora do escopo concluído

- publicação e validação por URL real;
- envio de e-mail ou WhatsApp;
- armazenamento seguro de arquivos clínicos;
- execução de filas e tarefas agendadas;
- testes de carga, restauração e resposta a incidente;
- estoque e inteligência artificial clínica;
- aceitação jurídica/LGPD pela clínica controladora dos dados.
