import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, MessageCircle, Plus, RefreshCw, Search, Send } from "lucide-react";
import {
  api,
  type WhatsAppConnectionStatus,
  type WhatsAppConversation,
  type WhatsAppMessage,
  type WhatsAppSend,
} from "./api";
import { useDemo } from "./store";
import { Badge, Button, Empty, Header, Panel, Select, inputClass } from "./ui";
import { WhatsAppSimulation } from "./WhatsAppSimulation";

const refreshInterval = 8_000;
const maxMessageLength = 4_096;
const statusLabels: Record<WhatsAppMessage["status"], string> = {
  received: "Recebida",
  submitting: "Enviando",
  submitted: "Aceita pela Meta",
  accepted: "Aceita pela Omni",
  pending: "Aguardando envio",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha no envio",
  unknown: "Envio inconclusivo",
};
const connectionLabels: Record<WhatsAppConnectionStatus, string> = {
  connected: "Canal conectado",
  disconnected: "Canal desconectado",
  connecting: "Canal em conexão",
  unknown: "Conexão não verificada",
  not_configured: "Canal não configurado",
};
const formatTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function usePolling<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    void load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setValue(data);
        setError("");
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "Não foi possível atualizar.");
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
      });
  }, [load]);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden && !pending.current) refresh();
    }, refreshInterval);
    return () => {
      window.clearInterval(timer);
      pending.current?.abort();
    };
  }, [refresh]);
  return { value, error, refresh };
}

function displayName(conversation: WhatsAppConversation) {
  return conversation.patientName || "Contato sem vínculo";
}

function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}

export function WhatsApp() {
  const { authMode, permissions } = useDemo();
  const [params] = useSearchParams();
  const [simulation, setSimulation] = useState(false);
  const patientId = params.get("paciente") || undefined;
  const simulated = authMode === "demo" || simulation;
  return (
    <>
      <Header
        title={simulated ? "WhatsApp · Simulação" : "WhatsApp"}
        subtitle={
          simulated
            ? "Dados fictícios. Nenhuma mensagem será enviada ao WhatsApp."
            : "Responda aos pacientes e acompanhe o atendimento."
        }
      >
        {authMode === "authenticated" && (
          <Button variant="secondary" onClick={() => setSimulation((active) => !active)}>
            {simulation ? "Voltar ao WhatsApp real" : "Abrir simulação"}
          </Button>
        )}
      </Header>
      {simulated ? (
        <WhatsAppSimulation />
      ) : !permissions.includes("whatsapp.inbox.read") ? (
        <Panel>
          <Empty
            title="Acesso restrito"
            text="Seu perfil não possui permissão para consultar conversas desta clínica."
          />
        </Panel>
      ) : (
        <Inbox
          key={patientId ?? "all-conversations"}
          {...(patientId ? { patientId } : {})}
          canSend={permissions.includes("whatsapp.inbox.send")}
        />
      )}
    </>
  );
}

function Inbox({ patientId, canSend }: { patientId?: string; canSend: boolean }) {
  const { data } = useDemo();
  const load = useCallback(
    (signal: AbortSignal) => api.whatsappInbox(signal, patientId),
    [patientId],
  );
  const { value, error, refresh } = usePolling(load);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [threadClosed, setThreadClosed] = useState(false);
  const [choosingPatient, setChoosingPatient] = useState(false);
  const [targetPatient, setTargetPatient] = useState(patientId ?? "");
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const conversations = value?.conversations ?? [];
  const selectedId = threadClosed ? null : (selected ?? (patientId ? conversations[0]?.id : null));
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const matching = conversations.filter(
    (item) =>
      (!onlyPending || item.awaitingReply) &&
      (!search || `${displayName(item)} ${item.phone}`.toLocaleLowerCase("pt-BR").includes(search)),
  );
  const availablePatients = data.patients
    .filter((patient) => patient.phone.trim() && (!patientId || patient.id === patientId))
    .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));
  const provider = value?.provider;
  const connection = value?.connectionStatus;
  const channelOffline = connection === "disconnected" || connection === "connecting";

  async function startConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startingRef.current || !targetPatient || !canSend || !value?.canStart) return;
    startingRef.current = true;
    setStarting(true);
    setStartError("");
    try {
      const { conversation } = await api.startWhatsAppConversation(targetPatient);
      setSelected(conversation.id);
      setThreadClosed(false);
      setChoosingPatient(false);
      refresh();
    } catch (failure) {
      setStartError(
        failure instanceof Error ? failure.message : "Não foi possível abrir a conversa.",
      );
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {value && (
            <Badge>
              {connection
                ? connectionLabels[connection]
                : value.configured
                  ? "Canal configurado"
                  : "Canal não configurado"}
            </Badge>
          )}
          {provider === "zapi_omni" && (
            <span className="text-xs text-muted-foreground">Z-API Omni</span>
          )}
          {patientId && (
            <Link
              to="/app/whatsapp"
              className="rounded-lg px-3 py-2 text-xs font-semibold text-primary hover:bg-secondary"
            >
              Todas as conversas
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canSend && value?.canStart && (
            <Button
              aria-expanded={choosingPatient}
              onClick={() => {
                setChoosingPatient((visible) => !visible);
                setStartError("");
              }}
            >
              <Plus size={16} /> Nova conversa
            </Button>
          )}
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw size={15} /> Atualizar conversas
          </Button>
        </div>
      </div>
      {error && <InlineError message={error} />}
      {choosingPatient && (
        <Panel>
          <form className="flex flex-wrap items-end gap-3 p-4" onSubmit={startConversation}>
            <div className="min-w-55 flex-1">
              <Select
                label="Paciente autorizado a receber mensagens"
                value={targetPatient}
                disabled={starting}
                onChange={(event) => setTargetPatient(event.target.value)}
              >
                <option value="">Selecione um paciente com telefone</option>
                {availablePatients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name} · {patient.phone}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="submit"
              disabled={starting || !availablePatients.some(({ id }) => id === targetPatient)}
            >
              {starting ? "Abrindo…" : "Abrir conversa"}
            </Button>
            {startError && (
              <div className="w-full">
                <InlineError message={startError} />
              </div>
            )}
          </form>
        </Panel>
      )}
      {value && !value.configured && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Configure o canal no servidor para receber e enviar mensagens reais. Você pode apresentar
          o fluxo pelo botão de simulação.
        </p>
      )}
      {channelOffline && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Confira a conexão do número no painel da Omni e atualize o status. O histórico continua
          disponível.
        </p>
      )}
      <Panel className="grid lg:grid-cols-[minmax(245px,31%)_minmax(0,1fr)]">
        <aside
          className={`min-w-0 lg:border-r lg:border-border ${selectedId ? "hidden lg:block" : ""}`}
          aria-label="Conversas"
        >
          <div className="space-y-3 border-b border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Conversas</h2>
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
                size={16}
              />
              <input
                className={`${inputClass} pl-9`}
                aria-label="Buscar por nome ou telefone"
                placeholder="Buscar por nome ou telefone"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Button
              variant={onlyPending ? "primary" : "secondary"}
              className="min-h-8 text-xs"
              aria-pressed={onlyPending}
              onClick={() => setOnlyPending((active) => !active)}
            >
              Sem resposta
            </Button>
          </div>
          {!value && !error && (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Carregando conversas…
            </p>
          )}
          {value && !matching.length && (
            <Empty
              title={search || onlyPending ? "Nenhum resultado" : "Nenhuma conversa disponível"}
              text={
                search || onlyPending
                  ? "Ajuste a busca ou os filtros."
                  : patientId
                    ? "Nenhuma conversa foi vinculada a este cadastro."
                    : "As mensagens recebidas pelo número da clínica aparecem aqui."
              }
            />
          )}
          <ul className="max-h-[58dvh] divide-y divide-border overflow-y-auto lg:max-h-120">
            {matching.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === item.id}
                  className={`flex w-full min-w-0 gap-3 border-l-2 px-4 py-3 text-left hover:bg-secondary ${selectedId === item.id ? "border-primary bg-secondary" : "border-transparent"}`}
                  onClick={() => {
                    setSelected(item.id);
                    setThreadClosed(false);
                  }}
                >
                  <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    <MessageCircle aria-hidden="true" size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {displayName(item)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.phone}
                    </span>
                    {item.lastMessage && (
                      <span className="mt-1.5 block truncate text-xs">{item.lastMessage}</span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {item.awaitingReply && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
                          Sem resposta
                        </span>
                      )}
                      {item.lastMessageAt && (
                        <time dateTime={item.lastMessageAt}>
                          {formatTime.format(new Date(item.lastMessageAt))}
                        </time>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {selectedId ? (
          <Thread
            key={selectedId}
            id={selectedId}
            configured={value?.configured === true}
            canSend={canSend}
            channelOffline={channelOffline}
            isOmni={provider === "zapi_omni"}
            retryKeys={retryKeys}
            refreshInbox={refresh}
            goBack={() => {
              setSelected(null);
              setThreadClosed(true);
            }}
          />
        ) : (
          <div className="hidden min-h-[32rem] place-items-center bg-background/55 lg:grid">
            <Empty
              title="Selecione uma conversa"
              text="Abra uma conversa para consultar o histórico e responder pelo WhatsApp."
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

function Thread({
  id,
  configured,
  canSend,
  channelOffline,
  isOmni,
  retryKeys,
  refreshInbox,
  goBack,
}: {
  id: string;
  configured: boolean;
  canSend: boolean;
  channelOffline: boolean;
  isOmni: boolean;
  retryKeys: RefObject<Map<string, string>>;
  refreshInbox: () => void;
  goBack: () => void;
}) {
  const load = useCallback((signal: AbortSignal) => api.whatsappThread(id, signal), [id]);
  const { value, error, refresh } = usePolling(load);
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [older, setOlder] = useState<{ messages: WhatsAppMessage[]; cursor: string | null } | null>(
    null,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const sendingRef = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const nearBottom = useRef(true);
  const cursor = older ? older.cursor : value?.nextCursor;
  const latest = value?.messages ?? [];
  const latestIds = new Set(latest.map(({ id }) => id));
  const messages = [...(older?.messages.filter(({ id }) => !latestIds.has(id)) ?? []), ...latest];
  const lastMessageId = value?.messages.at(-1)?.id;
  const canSendText = value?.conversation.canSendText === true;
  const usesTemplate = !canSendText || Boolean(templateId);
  const selectedTemplate = value?.templates.find((item) => item.id === templateId);
  const ready = usesTemplate ? Boolean(selectedTemplate) : Boolean(text.trim());

  useEffect(() => {
    if (nearBottom.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [lastMessageId]);

  useEffect(() => () => olderRequest.current?.abort(), []);

  useLayoutEffect(() => {
    if (!history.current || !scrollAnchor.current) return;
    const { height, top } = scrollAnchor.current;
    history.current.scrollTop = top + history.current.scrollHeight - height;
    scrollAnchor.current = null;
  }, [older]);

  async function loadOlder() {
    if (!cursor || olderRequest.current) return;
    const request = new AbortController();
    olderRequest.current = request;
    setLoadingOlder(true);
    setHistoryError("");
    try {
      const page = await api.whatsappThread(id, request.signal, cursor);
      if (request.signal.aborted) return;
      if (history.current) {
        scrollAnchor.current = {
          height: history.current.scrollHeight,
          top: history.current.scrollTop,
        };
      }
      setOlder({
        messages: [...page.messages, ...(older?.messages ?? latest)],
        cursor: page.nextCursor,
      });
    } catch (failure) {
      if (!request.signal.aborted) {
        setHistoryError(
          failure instanceof Error
            ? failure.message
            : "Não foi possível carregar mensagens anteriores.",
        );
      }
    } finally {
      if (!request.signal.aborted) {
        olderRequest.current = null;
        setLoadingOlder(false);
      }
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || !ready || !configured || !canSend || channelOffline) return;
    const fingerprint = JSON.stringify([id, usesTemplate, usesTemplate ? templateId : text.trim()]);
    const idempotencyKey = retryKeys.current.get(fingerprint) ?? crypto.randomUUID();
    retryKeys.current.set(fingerprint, idempotencyKey);
    const input: WhatsAppSend = usesTemplate
      ? { templateId, idempotencyKey }
      : { text: text.trim(), idempotencyKey };
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    setNotice("");
    try {
      const response = await api.sendWhatsApp(id, input);
      if (response.message.status === "unknown" || response.message.status === "submitting") {
        setNotice("A confirmação do envio está pendente. Acompanhe o status no histórico.");
      } else if (response.message.status === "failed") {
        setNotice("O envio falhou. Confira o status no histórico.");
      } else if (response.message.status === "accepted" || response.message.status === "pending") {
        retryKeys.current.delete(fingerprint);
        setNotice(
          response.message.status === "accepted"
            ? "A Omni aceitou a mensagem. Acompanhe a confirmação de entrega no histórico."
            : "A mensagem está aguardando envio. Acompanhe o status no histórico.",
        );
      } else {
        retryKeys.current.delete(fingerprint);
        setNotice("Mensagem registrada no histórico.");
      }
      setText("");
      setTemplateId("");
      nearBottom.current = true;
    } catch (failure) {
      setSendError(
        failure instanceof Error ? failure.message : "Não foi possível concluir o envio.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
      refresh();
      refreshInbox();
    }
  }

  return (
    <section
      aria-label="Histórico da conversa"
      className="flex min-h-[32rem] min-w-0 flex-col bg-background/55"
    >
      <header className="flex min-h-18 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        <Button
          variant="ghost"
          className="px-2 lg:hidden"
          onClick={goBack}
          aria-label="Voltar às conversas"
        >
          <ArrowLeft size={19} />
        </Button>
        {value && (
          <>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{displayName(value.conversation)}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{value.conversation.phone}</p>
            </div>
            {value.conversation.patientId && (
              <Link
                to={`/app/pacientes/${value.conversation.patientId}`}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-primary hover:bg-secondary"
              >
                Ver cadastro
              </Link>
            )}
          </>
        )}
      </header>
      {error && (
        <div className="p-4">
          <InlineError message={error} />
        </div>
      )}
      {value ? (
        <>
          <div
            ref={history}
            onScroll={(event) => {
              const element = event.currentTarget;
              nearBottom.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
            tabIndex={0}
            aria-label="Mensagens da conversa"
            className="min-h-52 max-h-[44dvh] flex-1 overflow-y-auto px-4 py-4 sm:px-6"
          >
            {cursor && (
              <div className="mb-3 text-center">
                <Button
                  variant="secondary"
                  className="text-xs"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
                </Button>
              </div>
            )}
            {historyError && <InlineError message={historyError} />}
            {messages.length ? (
              <ol className="space-y-3">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[min(85%,32rem)] rounded-xl border px-3.5 py-2.5 shadow-panel ${message.direction === "outbound" ? "border-primary/20 bg-secondary" : "border-border bg-card"}`}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {message.text || "Mensagem sem texto"}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <time dateTime={message.occurredAt}>
                          {formatTime.format(new Date(message.occurredAt))}
                        </time>
                        <span className={message.status === "failed" ? "text-red-700" : ""}>
                          {statusLabels[message.status]}
                        </span>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty title="Sem mensagens" text="Nenhuma mensagem foi registrada nesta conversa." />
            )}
          </div>
          {!canSend ||
          !configured ||
          channelOffline ||
          value.conversation.sendBlock === "contact_opted_out" ||
          value.conversation.sendBlock === "channel_disabled" ? (
            <p className="border-t border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              {!canSend
                ? "Seu perfil pode consultar esta conversa."
                : value.conversation.sendBlock === "contact_opted_out"
                  ? "Este contato pediu para parar de receber mensagens."
                  : channelOffline
                    ? "A transmissão está indisponível até o canal se conectar novamente."
                    : configured
                      ? "Esta conversa pertence a outro canal."
                      : "Configure o canal no servidor para enviar mensagens."}
            </p>
          ) : (
            <form className="space-y-3 border-t border-border bg-card p-4" onSubmit={send}>
              {!canSendText && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  {isOmni
                    ? "O canal não permite mensagens de texto para este contato agora."
                    : "A janela de 24 horas terminou. Para iniciar um novo contato, selecione um modelo aprovado pela Meta."}
                  {!value.templates.length &&
                    !value.templatesUnavailable &&
                    " Nenhum modelo está disponível para este contato."}
                </p>
              )}
              {value.templatesUnavailable && (
                <InlineError message="A Meta não disponibilizou os modelos agora. Tente atualizar a conversa." />
              )}
              {value.templates.length > 0 && (
                <Select
                  label="Tipo de mensagem"
                  value={templateId}
                  disabled={sending}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  <option value="">
                    {canSendText ? "Mensagem de texto" : "Selecione um modelo aprovado"}
                  </option>
                  {value.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · {template.languageCode}
                    </option>
                  ))}
                </Select>
              )}
              {canSendText && !usesTemplate && (
                <label className="grid gap-1.5 text-[13px] font-medium">
                  Mensagem
                  <textarea
                    className={`${inputClass} min-h-20 resize-y`}
                    placeholder="Escreva sua resposta"
                    value={text}
                    maxLength={maxMessageLength}
                    disabled={sending}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
              )}
              {sendError && <InlineError message={sendError} />}
              {notice && (
                <p role="status" className="text-xs text-muted-foreground">
                  {notice}
                </p>
              )}
              {canSendText || value.templates.length > 0 ? (
                <div className="flex justify-end">
                  <Button type="submit" disabled={!ready || sending}>
                    <Send size={16} /> {sending ? "Enviando…" : "Enviar pelo WhatsApp"}
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </>
      ) : (
        !error && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Carregando mensagens…
          </p>
        )
      )}
    </section>
  );
}
