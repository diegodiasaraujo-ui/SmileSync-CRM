import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import {
  Plus,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  CalendarPlus,
  CreditCard,
  FilePlus2,
  MoreHorizontal,
  ArrowRight,
  Download,
  Tag,
  Check,
  Clock3,
  FileText,
  Phone,
  Mail,
  History,
  CircleAlert,
} from "lucide-react";
import { useDemo } from "./store";
import {
  DEMO_DATE,
  activeAppointment,
  addDays,
  currency,
  financialStatus,
  shortDate,
  professionalNames,
  uid,
  type Patient,
} from "./data";
import {
  Header,
  Button,
  Field,
  Select,
  Panel,
  Table,
  Badge,
  Avatar,
  IconButton,
  Empty,
  Overlay,
  Tabs,
  Metric,
  inputClass,
  exportCSV,
} from "./ui";
import { ReportButton } from "./Reports";
import { Treatments, Quotes, Finance } from "./Operations";
import { FINANCE_MODULE_LABEL, TREATMENTS_MODULE_LABEL } from "./moduleLabels";

function patientTabLabel(tab: string) {
  if (tab === "Tratamentos") return TREATMENTS_MODULE_LABEL;
  if (tab === "Financeiro") return FINANCE_MODULE_LABEL;
  return tab;
}

function patientTabValue(label: string) {
  if (label === TREATMENTS_MODULE_LABEL) return "Tratamentos";
  if (label === FINANCE_MODULE_LABEL) return "Financeiro";
  return label;
}

export function Patients() {
  const { data, canFinance, open } = useDemo();
  const availableProfessionals = professionalNames(data);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const param = (key: string) => params.get(key) || "";
  const setParam = (key: string, value: string) => {
    setPage(1);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      value ? next.set(key, value) : next.delete(key);
      return next;
    });
  };
  const stats = (person: Patient) => {
    const treatments = data.treatments.filter((item) => item.patientId === person.id);
    const charges = data.charges.filter((item) => item.patientId === person.id);
    const total = treatments.reduce((sum, item) => sum + item.total, 0);
    const paid = charges.filter((item) => item.paid).reduce((sum, item) => sum + item.value, 0);
    const next = data.appointments
      .filter(
        (item) => item.patientId === person.id && item.date >= DEMO_DATE && activeAppointment(item),
      )
      .sort((first, second) =>
        `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`),
      )[0];
    const last = data.interactions
      .filter((item) => item.patientId === person.id)
      .sort((first, second) => second.date.localeCompare(first.date))[0];
    return {
      treatments,
      charges,
      total,
      paid,
      next,
      last,
      status: financialStatus(charges),
    };
  };
  const filtered = data.patients
    .filter((person) => {
      const details = stats(person);
      const shortcut = param("segmento");
      return (
        (!param("busca") ||
          `${person.name} ${person.phone} ${person.email}`
            .toLowerCase()
            .includes(param("busca").toLowerCase())) &&
        (!param("profissional") ||
          details.treatments.some((item) => item.professional === param("profissional"))) &&
        (!param("tratamento") ||
          details.treatments.some((item) => item.name === param("tratamento"))) &&
        (!param("status") || details.treatments.some((item) => item.status === param("status"))) &&
        (!param("financeiro") || details.status === param("financeiro")) &&
        (!param("inicio") || person.since >= param("inicio")) &&
        (!param("fim") || person.since <= param("fim")) &&
        (!shortcut ||
          (shortcut === "Sem retorno" && !details.next && details.treatments.length > 0) ||
          (shortcut === "Pagamentos vencidos" && details.status === "Vencido") ||
          (shortcut === "Tratamentos parados" &&
            details.treatments.some((item) => item.status === "Pausado")) ||
          (shortcut === "Novos pacientes" && person.since >= addDays(DEMO_DATE, -30)))
      );
    })
    .sort((first, second) => {
      const a = stats(first),
        b = stats(second);
      const sort = param("ordem");
      return sort === "maior-valor"
        ? b.total - a.total
        : sort === "valor-pendente"
          ? b.total - b.paid - (a.total - a.paid)
          : sort === "ultima-interacao"
            ? (b.last?.date || "").localeCompare(a.last?.date || "")
            : sort === "cadastro"
              ? second.since.localeCompare(first.since)
              : `${a.next?.date || "9999"}${a.next?.time || ""}`.localeCompare(
                  `${b.next?.date || "9999"}${b.next?.time || ""}`,
                );
    });
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const reportHeaders = [
    "Paciente",
    "Próxima consulta",
    "Tratamento",
    ...(canFinance
      ? ["Valor contratado", "Valor pago", "Valor em aberto", "Status financeiro"]
      : []),
    "Status do tratamento",
    "Última interação",
  ];
  const reportRow = (person: Patient) => {
    const details = stats(person);
    return [
      person.name,
      details.next ? `${shortDate(details.next.date)} · ${details.next.time}` : "Sem retorno",
      details.treatments.map((item) => item.name).join(", "),
      ...(canFinance
        ? [
            currency(details.total),
            currency(details.paid),
            currency(details.total - details.paid),
            details.status,
          ]
        : []),
      details.treatments[0]?.status || "Sem tratamento",
      details.last ? shortDate(details.last.date) : "—",
    ];
  };
  const reportRows = filtered.map(reportRow);
  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  const quick = (id: string, kind: "message" | "appointment" | "payment" | "quote") => {
    setMenu(null);
    open({ kind, patientId: id });
  };
  return (
    <>
      <Header
        title="Pacientes"
        subtitle={`${data.patients.length} pacientes. Encontre o contexto e resolva a próxima ação.`}
      >
        <ReportButton module="Pacientes" headers={reportHeaders} rows={reportRows} />
        <Button onClick={() => open({ kind: "patient" })}>
          <Plus size={16} />
          Novo paciente
        </Button>
      </Header>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 min-w-48 flex-1 items-center gap-2 rounded-lg border border-border bg-white px-3">
          <Search size={17} className="text-muted-foreground" />
          <input
            value={param("busca")}
            onChange={(event) => setParam("busca", event.target.value)}
            aria-label="Buscar pacientes"
            placeholder="Buscar por nome, telefone ou e-mail"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <Button variant="secondary" onClick={() => setFilters(!filters)} aria-expanded={filters}>
          <SlidersHorizontal size={16} />
          Filtros
        </Button>
        <select
          aria-label="Ordenar pacientes"
          className={`${inputClass} w-auto`}
          value={param("ordem")}
          onChange={(event) => setParam("ordem", event.target.value)}
        >
          <option value="">Próxima consulta</option>
          {canFinance && (
            <>
              <option value="maior-valor">Maior valor contratado</option>
              <option value="valor-pendente">Maior valor em aberto</option>
            </>
          )}
          <option value="ultima-interacao">Última interação</option>
          <option value="cadastro">Data de cadastro</option>
        </select>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {[
          "Todos",
          "Sem retorno",
          ...(canFinance ? ["Pagamentos vencidos"] : []),
          "Tratamentos parados",
          "Novos pacientes",
        ].map((item) => (
          <button
            key={item}
            aria-pressed={(param("segmento") || "Todos") === item}
            onClick={() => setParam("segmento", item === "Todos" ? "" : item)}
            className={`min-h-9 rounded-full px-3.5 text-xs font-medium ${
              param("segmento") === item || (!param("segmento") && item === "Todos")
                ? "bg-primary text-white"
                : "border border-border bg-white text-muted-foreground hover:bg-secondary"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      {filters && (
        <section
          aria-label="Filtros de pacientes"
          className="mb-5 grid gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Select
            label="Profissional"
            value={param("profissional")}
            onChange={(event) => setParam("profissional", event.target.value)}
          >
            <option value="">Todos</option>
            {availableProfessionals.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Select
            label="Tratamento"
            value={param("tratamento")}
            onChange={(event) => setParam("tratamento", event.target.value)}
          >
            <option value="">Todos</option>
            {Array.from(new Set(data.treatments.map((item) => item.name))).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Select
            label="Status do tratamento"
            value={param("status")}
            onChange={(event) => setParam("status", event.target.value)}
          >
            <option value="">Todos</option>
            {Array.from(new Set(data.treatments.map((item) => item.status))).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          {canFinance && (
            <Select
              label="Status financeiro"
              value={param("financeiro")}
              onChange={(event) => setParam("financeiro", event.target.value)}
            >
              <option value="">Todos</option>
              {["Pago", "Em dia", "Parcialmente pago", "Vencido", "Sem cobrança"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          )}
          <Field
            label="Cadastrado a partir de"
            type="date"
            value={param("inicio")}
            onChange={(event) => setParam("inicio", event.target.value)}
          />
          <Field
            label="Cadastrado até"
            type="date"
            value={param("fim")}
            onChange={(event) => setParam("fim", event.target.value)}
          />
          <Button variant="ghost" className="self-end" onClick={() => setParams({})}>
            Limpar todos os filtros
          </Button>
        </section>
      )}
      {!!selected.length && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-accent p-3">
          <strong className="mr-3 text-xs text-primary">
            {selected.length} pacientes selecionados
          </strong>
          {["Enviar WhatsApp", "Agendar retorno", "Adicionar tag", "Registrar interação"].map(
            (item) => (
              <Button
                key={item}
                variant="secondary"
                className="min-h-8 text-xs"
                onClick={() => setBulk(item)}
              >
                {item}
              </Button>
            ),
          )}
          <Button
            variant="secondary"
            className="min-h-8 text-xs"
            onClick={() =>
              exportCSV(
                "pacientes-selecionados",
                reportHeaders,
                data.patients.filter((person) => selected.includes(person.id)).map(reportRow),
              )
            }
          >
            <Download size={14} />
            Exportar
          </Button>
          <Button variant="ghost" className="min-h-8 text-xs" onClick={() => setSelected([])}>
            Limpar seleção
          </Button>
        </div>
      )}
      <Panel>
        {filtered.length ? (
          <Table headers={["", ...reportHeaders, ""]}>
            {visible.map((person) => {
              const details = stats(person);
              return (
                <tr key={person.id} className={selected.includes(person.id) ? "bg-accent/50" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${person.name}`}
                      checked={selected.includes(person.id)}
                      onChange={() => toggle(person.id)}
                      className="size-4 accent-primary"
                    />
                  </td>
                  <td>
                    <button
                      className="flex items-center gap-3 text-left"
                      onClick={() =>
                        navigate(`/app/pacientes/${person.id}`, {
                          state: {
                            returnTo: location.pathname + location.search,
                          },
                        })
                      }
                    >
                      <Avatar name={person.name} />
                      <span>
                        <span className="font-medium hover:text-primary">{person.name}</span>
                        <small className="mt-1 block text-xs text-muted-foreground">
                          {person.phone}
                        </small>
                        {person.city !== "Patos de Minas" && (
                          <small className="mt-1 block text-[11px] text-blue-700">
                            Outra cidade
                          </small>
                        )}
                      </span>
                    </button>
                  </td>
                  <td className="text-xs">
                    {details.next ? (
                      <button
                        className="hover:text-primary"
                        onClick={() =>
                          navigate(
                            `/app/agenda?consulta=${details.next.id}&data=${details.next.date}`,
                          )
                        }
                      >
                        {shortDate(details.next.date)} · {details.next.time}
                      </button>
                    ) : (
                      <button
                        className="text-amber-800 hover:underline"
                        onClick={() => quick(person.id, "appointment")}
                      >
                        Agendar retorno
                      </button>
                    )}
                  </td>
                  <td className="text-xs">{details.treatments[0]?.name || "Sem tratamento"}</td>
                  {canFinance && (
                    <>
                      <td className="tabular-nums">{currency(details.total)}</td>
                      <td className="tabular-nums">{currency(details.paid)}</td>
                      <td className="font-medium tabular-nums">
                        {currency(details.total - details.paid)}
                      </td>
                      <td>
                        <Badge>{details.status}</Badge>
                      </td>
                    </>
                  )}
                  <td>
                    <Badge>{details.treatments[0]?.status || "Sem tratamento"}</Badge>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {details.last ? shortDate(details.last.date) : "Sem interação"}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <IconButton
                        label="Enviar mensagem"
                        className="size-8"
                        onClick={() => quick(person.id, "message")}
                      >
                        <MessageCircle size={16} />
                      </IconButton>
                      <IconButton
                        label="Agendar consulta"
                        className="size-8"
                        onClick={() => quick(person.id, "appointment")}
                      >
                        <CalendarPlus size={16} />
                      </IconButton>
                      <IconButton
                        label={`Mais ações de ${person.name}`}
                        className="size-8"
                        onClick={() => setMenu(person.id)}
                      >
                        <MoreHorizontal size={17} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty
            title="Nenhum paciente encontrado"
            text="Não encontramos pacientes com esses filtros."
            action={
              <Button variant="secondary" onClick={() => setParams({})}>
                Limpar filtros
              </Button>
            }
          />
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              aria-label="Selecionar pacientes desta página"
              checked={!!visible.length && visible.every((person) => selected.includes(person.id))}
              onChange={() =>
                setSelected((previous) =>
                  visible.every((person) => previous.includes(person.id))
                    ? previous.filter((id) => !visible.some((person) => person.id === id))
                    : Array.from(new Set([...previous, ...visible.map((person) => person.id)])),
                )
              }
              className="size-4 accent-primary"
            />
            Selecionar página
          </label>
          <span className="text-xs text-muted-foreground">
            {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–
            {Math.min(currentPage * pageSize, filtered.length)} de {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <IconButton
              label="Página anterior"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={17} />
            </IconButton>
            <span className="text-xs">
              {currentPage} / {maxPage}
            </span>
            <IconButton
              label="Próxima página"
              disabled={currentPage === maxPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={17} />
            </IconButton>
          </div>
        </footer>
      </Panel>
      {menu && (
        <Overlay
          title={`Ações · ${data.patients.find((person) => person.id === menu)?.name}`}
          onClose={() => setMenu(null)}
        >
          <div className="grid gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                navigate(`/app/pacientes/${menu}`, {
                  state: { returnTo: location.pathname + location.search },
                });
                setMenu(null);
              }}
            >
              Abrir paciente
              <ArrowRight size={16} />
            </Button>
            <Button variant="secondary" onClick={() => quick(menu, "message")}>
              <MessageCircle size={16} />
              WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => quick(menu, "appointment")}>
              <CalendarPlus size={16} />
              Agendar
            </Button>
            {canFinance && (
              <>
                <Button variant="secondary" onClick={() => quick(menu, "payment")}>
                  <CreditCard size={16} />
                  Registrar pagamento
                </Button>
                <Button variant="secondary" onClick={() => quick(menu, "quote")}>
                  <FilePlus2 size={16} />
                  Criar orçamento
                </Button>
              </>
            )}
          </div>
        </Overlay>
      )}
      {bulk && <BulkAction mode={bulk} ids={selected} close={() => setBulk(null)} />}
    </>
  );
}
function BulkAction({ mode, ids, close }: { mode: string; ids: string[]; close: () => void }) {
  const { data, update, notify, open, record, authMode, command } = useDemo();
  const [text, setText] = useState("");
  const people = data.patients.filter((person) => ids.includes(person.id));
  return (
    <Overlay title={`${mode} · ${people.length} pacientes`} onClose={close}>
      {["Enviar WhatsApp", "Agendar retorno"].includes(mode) ? (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {mode === "Enviar WhatsApp"
              ? "Revise e abra cada conversa individualmente para evitar mensagens sem contexto."
              : "Cada retorno precisa de um horário disponível. Abra o agendamento de cada paciente."}
          </p>
          {people.map((person) => (
            <div
              key={person.id}
              className="flex items-center justify-between border-b border-border py-3 text-sm"
            >
              <span>{person.name}</span>
              <Button
                variant="secondary"
                onClick={() =>
                  open({
                    kind: mode === "Enviar WhatsApp" ? "message" : "appointment",
                    patientId: person.id,
                  })
                }
              >
                {mode === "Enviar WhatsApp" ? "Preparar mensagem" : "Agendar"}
              </Button>
            </div>
          ))}
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              if (authMode === "authenticated")
                await command(
                  mode === "Adicionar tag" ? "patient.bulk-tag" : "interaction.bulk-create",
                  { patientIds: ids, text },
                );
              else if (mode === "Adicionar tag")
                update((previous) => ({
                  ...previous,
                  patients: previous.patients.map((person) =>
                    ids.includes(person.id)
                      ? {
                          ...person,
                          tags: Array.from(new Set([...person.tags, text.trim()])),
                        }
                      : person,
                  ),
                }));
              else
                people.forEach((person) =>
                  record(person.id, "Interação registrada em lote", text, "Contato"),
                );
            } catch (submitError) {
              notify(
                submitError instanceof Error
                  ? submitError.message
                  : "Não foi possível aplicar a ação em lote.",
                true,
              );
              return;
            }
            notify(
              `${
                mode === "Adicionar tag" ? "Tag adicionada" : "Interação registrada"
              } para ${people.length} pacientes.`,
            );
            close();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Esta ação será aplicada aos pacientes selecionados.
          </p>
          <Field
            label={mode === "Adicionar tag" ? "Nome da tag" : "Descrição da interação"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
          />
          <Button type="submit">Aplicar a {people.length} pacientes</Button>
        </form>
      )}
    </Overlay>
  );
}
export function PatientProfile() {
  const { id } = useParams();
  const { data, canFinance, open, update, notify, authMode, command } = useDemo();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [document, setDocument] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const person = data.patients.find((patient) => patient.id === id);
  if (!person)
    return (
      <Empty
        title="Paciente não encontrado"
        text="O registro pode ter sido removido ou o endereço está incorreto."
        action={<Button onClick={() => navigate("/app/pacientes")}>Ver pacientes</Button>}
      />
    );
  const treatments = data.treatments.filter((item) => item.patientId === person.id);
  const charges = data.charges.filter((item) => item.patientId === person.id);
  const total = treatments.reduce((sum, item) => sum + item.total, 0);
  const paid = charges.filter((item) => item.paid).reduce((sum, item) => sum + item.value, 0);
  const appointments = data.appointments
    .filter((item) => item.patientId === person.id)
    .sort((first, second) =>
      `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`),
    );
  const next = appointments.find((item) => item.date >= DEMO_DATE && activeAppointment(item));
  const tabs = [
    "Resumo",
    "Agenda",
    "Tratamentos",
    ...(canFinance ? ["Orçamentos", "Financeiro"] : []),
    "WhatsApp",
    "Documentos",
    "Histórico",
  ];
  const tab = tabs.includes(params.get("aba") || "") ? params.get("aba")! : "Resumo";
  const setTab = (value: string) => setParams({ aba: value }, { state: location.state });
  const history = data.interactions
    .filter(
      (item) =>
        item.patientId === person.id &&
        (canFinance || !["Financeiro", "Orçamento"].includes(item.kind)),
    )
    .sort((first, second) => second.date.localeCompare(first.date));
  const lastMessage = history.find((item) => item.kind === "WhatsApp");
  const timeline = (
    <div className="px-5 pb-5">
      {history.length ? (
        history.map((item) => (
          <div
            key={item.id}
            className="relative flex gap-3 border-b border-border py-4 last:border-0"
          >
            <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              {item.kind === "WhatsApp" ? (
                <MessageCircle size={14} />
              ) : item.kind === "Financeiro" ? (
                <CreditCard size={14} />
              ) : (
                <History size={14} />
              )}
            </span>
            <div>
              <p className="text-xs text-muted-foreground">
                {shortDate(item.date)} · {item.date.slice(11, 16)} · {item.kind}
              </p>
              <p className="mt-1.5 text-sm font-medium">{item.title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {item.text}
              </p>
            </div>
          </div>
        ))
      ) : (
        <Empty
          title="Histórico ainda não iniciado"
          text="Consultas, contatos e evoluções aparecerão aqui."
        />
      )}
    </div>
  );
  const docs =
    person.id === "mariana-oliveira"
      ? [
          "Atestado de comparecimento",
          "Consentimento informado",
          "Prescrição pós-procedimento",
          "Afastamento · 1 dia",
        ]
      : [];
  return (
    <>
      <Button
        variant="ghost"
        className="mb-4 -ml-3"
        onClick={() => navigate(location.state?.returnTo || "/app/pacientes")}
      >
        <ChevronLeft size={16} />
        Voltar ao contexto anterior
      </Button>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={person.name} size="large" />
          <div>
            <h1 className="text-[25px] font-semibold">{person.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Paciente desde {shortDate(person.since)} {person.since.slice(0, 4)} · {person.city}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{treatments[0]?.status || "Sem tratamento"}</Badge>
              {person.city !== "Patos de Minas" && <Badge>Outra cidade</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => open({ kind: "message", patientId: person.id })}
          >
            <MessageCircle size={16} />
            WhatsApp
          </Button>
          <Button onClick={() => open({ kind: "appointment", patientId: person.id })}>
            <CalendarPlus size={16} />
            Agendar
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Editar cadastro
          </Button>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-white xl:grid-cols-4">
        <Metric
          label="Próxima consulta"
          value={next ? `${shortDate(next.date)} · ${next.time}` : "Sem retorno"}
          detail={next?.procedure || "Combine uma próxima data"}
          onClick={() =>
            next
              ? navigate(`/app/agenda?consulta=${next.id}&data=${next.date}`)
              : open({ kind: "appointment", patientId: person.id })
          }
        />
        {canFinance ? (
          <>
            <Metric
              label="Valor contratado"
              value={currency(total)}
              detail={`${treatments.length} tratamento(s)`}
            />
            <Metric
              label="Valor pago"
              value={currency(paid)}
              detail="Pagamentos registrados"
              onClick={() => setTab("Financeiro")}
            />
            <Metric
              label="Valor em aberto"
              value={currency(total - paid)}
              detail={financialStatus(charges)}
              onClick={() => setTab("Financeiro")}
            />
          </>
        ) : (
          <>
            <Metric
              label="Tratamentos"
              value={treatments.length}
              detail="Histórico clínico centralizado"
            />
            <Metric
              label="Etapas concluídas"
              value={treatments.reduce(
                (sum, item) => sum + item.steps.filter((step) => step.done).length,
                0,
              )}
              detail="Evoluções registradas"
            />
            <Metric
              label="Última interação"
              value={history[0] ? shortDate(history[0].date) : "—"}
              detail="Contato e acompanhamento"
            />
          </>
        )}
      </div>
      <Tabs
        tabs={tabs.map(patientTabLabel)}
        selected={patientTabLabel(tab)}
        onChange={(label) => setTab(patientTabValue(label))}
      />
      {tab === "Resumo" && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Panel
            title="Histórico recente"
            action={
              <Button variant="ghost" onClick={() => open({ kind: "note", patientId: person.id })}>
                <Plus size={15} />
                Registrar interação
              </Button>
            }
          >
            {timeline}
          </Panel>
          <div className="space-y-5">
            <section className="rounded-xl bg-secondary p-5">
              <p className="text-xs font-medium text-primary">PRÓXIMA AÇÃO SUGERIDA</p>
              <h2 className="mt-3 text-base font-semibold">
                {next
                  ? next.status === "Confirmado"
                    ? "Preparar o próximo atendimento"
                    : "Confirmar a próxima consulta"
                  : "Entrar em contato para agendar retorno"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {next
                  ? `${next.procedure} em ${shortDate(next.date)}, às ${next.time}. ${
                      next.status === "Confirmado"
                        ? "Revise as etapas e o contexto clínico antes da consulta."
                        : "A presença ainda precisa de confirmação."
                    }`
                  : "Nenhuma consulta futura ativa. Combine a continuidade do cuidado com o paciente."}
              </p>
              <Button
                className="mt-4"
                onClick={() =>
                  open({
                    kind: next && next.status === "Confirmado" ? "note" : "message",
                    patientId: person.id,
                  })
                }
              >
                {next && next.status === "Confirmado" ? "Registrar evolução" : "Preparar contato"}
                <ArrowRight size={15} />
              </Button>
            </section>
            <Panel title="Dados e preferências">
              <div className="space-y-4 px-5 pb-5 text-sm">
                <a
                  className="flex items-center gap-2 text-primary"
                  href={`tel:${person.phone.replace(/\D/g, "")}`}
                >
                  <Phone size={15} />
                  {person.phone}
                </a>
                {person.email && (
                  <a
                    className="flex items-center gap-2 break-all text-primary"
                    href={`mailto:${person.email}`}
                  >
                    <Mail size={15} />
                    {person.email}
                  </a>
                )}
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {person.notes || "Nenhuma preferência registrada."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {person.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
      {tab === "Agenda" && (
        <Panel
          title="Consultas do paciente"
          action={
            <Button
              variant="ghost"
              onClick={() => open({ kind: "appointment", patientId: person.id })}
            >
              Agendar consulta
            </Button>
          }
        >
          {appointments.length ? (
            <Table headers={["Data", "Procedimento", "Profissional", "Sala", "Status", ""]}>
              {appointments.map((item) => (
                <tr key={item.id}>
                  <td>
                    {shortDate(item.date)} · {item.time}
                  </td>
                  <td>{item.procedure}</td>
                  <td>{item.professional}</td>
                  <td>{item.room}</td>
                  <td>
                    <Badge>{item.status}</Badge>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => navigate(`/app/agenda?consulta=${item.id}&data=${item.date}`)}
                    >
                      Abrir
                      <ArrowRight size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty
              title="Nenhuma consulta registrada"
              action={
                <Button onClick={() => open({ kind: "appointment", patientId: person.id })}>
                  Agendar consulta
                </Button>
              }
            />
          )}
        </Panel>
      )}
      {tab === "Tratamentos" && <Treatments patientId={person.id} />}
      {tab === "Orçamentos" && <Quotes patientId={person.id} />}
      {tab === "Financeiro" && <Finance patientId={person.id} />}
      {tab === "WhatsApp" && (
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <Panel title="Última conversa">
            <div className="px-5 pb-5">
              {lastMessage ? (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {shortDate(lastMessage.date)} · {lastMessage.date.slice(11, 16)}
                  </p>
                  <div className="rounded-xl bg-secondary p-5 text-sm leading-relaxed">
                    {lastMessage.text}
                  </div>
                </>
              ) : (
                <Empty
                  title="Nenhuma conversa registrada"
                  text="Prepare uma mensagem para iniciar o acompanhamento."
                />
              )}
              <Button
                className="mt-5"
                onClick={() => open({ kind: "message", patientId: person.id })}
              >
                <MessageCircle size={16} />
                Abrir conversa
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Mensagens preparadas não garantem envio. A conversa abre no WhatsApp.
              </p>
            </div>
          </Panel>
          <Panel title="Ações de acompanhamento">
            <div className="grid gap-2 px-5 pb-5">
              {[
                "Confirmar consulta",
                ...(canFinance ? ["Enviar orçamento", "Lembrar pagamento"] : []),
                "Solicitar retorno",
                "Instruções pós-procedimento",
              ].map((item) => (
                <Button
                  key={item}
                  variant="secondary"
                  className="justify-between"
                  onClick={() =>
                    open({
                      kind: "message",
                      patientId: person.id,
                      text: `Olá, ${person.name.split(" ")[0]}! ${
                        item === "Solicitar retorno"
                          ? "Vamos combinar seu retorno na clínica?"
                          : item === "Instruções pós-procedimento"
                            ? "Como está sua recuperação? Siga as orientações recebidas no atendimento e fale com a equipe se precisar."
                            : item === "Lembrar pagamento"
                              ? "Podemos ajudar com sua próxima parcela?"
                              : item === "Enviar orçamento"
                                ? "Seu orçamento está disponível. Podemos conversar sobre o plano de tratamento?"
                                : "Podemos confirmar sua próxima consulta?"
                      }`,
                    })
                  }
                >
                  {item}
                  <ArrowRight size={14} />
                </Button>
              ))}
            </div>
          </Panel>
        </div>
      )}
      {tab === "Documentos" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Medicamentos e prescrições">
            <div className="px-5 pb-5">
              {person.id === "mariana-oliveira" ? (
                <div className="space-y-4">
                  <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                    Registros fictícios preservados do prontuário demonstrativo. Não constituem
                    orientação ou prescrição médica.
                  </p>
                  {[
                    ["Amoxicilina 500 mg", "Registrada em 12 set · 7 dias"],
                    ["Ibuprofeno 600 mg", "Registrado em 12 set · uso se necessário"],
                  ].map(([name, text]) => (
                    <div key={name} className="border-b border-border pb-4">
                      <h3 className="text-sm font-medium">{name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Nenhuma medicação registrada"
                  text="Registre prescrições e medicações como evoluções clínicas."
                />
              )}
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => open({ kind: "note", patientId: person.id })}
              >
                Registrar prescrição / medicação
              </Button>
            </div>
          </Panel>
          <Panel title="Documentos, atestados e afastamentos">
            <div className="px-5 pb-5">
              {docs.map((item) => (
                <button
                  key={item}
                  onClick={() => setDocument(item)}
                  className="flex w-full items-center gap-3 border-b border-border py-4 text-left text-sm"
                >
                  <FileText size={18} className="text-primary" />
                  <span className="flex-1">
                    {item}
                    <small className="mt-1 block text-xs text-muted-foreground">
                      12 set 2026 · Dr. Sidney Almeida
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {history
                .filter((item) =>
                  ["Atestado", "Afastamento", "Prescrição", "Medicação"].includes(item.kind),
                )
                .map((item) => (
                  <div key={item.id} className="border-b border-border py-3">
                    <Badge>{item.kind}</Badge>
                    <p className="mt-2 text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.text}</p>
                  </div>
                ))}
              {!docs.length &&
                !history.some((item) =>
                  ["Atestado", "Afastamento", "Prescrição", "Medicação"].includes(item.kind),
                ) && (
                  <Empty
                    title="Nenhum documento registrado"
                    text="Documentos e registros clínicos ficam organizados aqui."
                  />
                )}
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => open({ kind: "note", patientId: person.id })}
              >
                Registrar documento
              </Button>
            </div>
          </Panel>
        </div>
      )}
      {tab === "Histórico" && (
        <Panel
          title="Histórico completo"
          action={
            <Button onClick={() => open({ kind: "note", patientId: person.id })}>
              <Plus size={15} />
              Registrar interação
            </Button>
          }
        >
          {timeline}
        </Panel>
      )}
      {editing && (
        <Overlay title="Editar cadastro do paciente" onClose={() => setEditing(false)} drawer>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              const payload = {
                patientId: person.id,
                name: String(fields.get("name")),
                phone: String(fields.get("phone")),
                email: String(fields.get("email")),
                city: String(fields.get("city")),
                notes: String(fields.get("notes")),
              };
              try {
                if (authMode === "authenticated") await command("patient.update", payload);
                else
                  update((previous) => ({
                    ...previous,
                    patients: previous.patients.map((patient) =>
                      patient.id === person.id ? { ...patient, ...payload } : patient,
                    ),
                  }));
              } catch (submitError) {
                notify(
                  submitError instanceof Error
                    ? submitError.message
                    : "Não foi possível atualizar o paciente.",
                  true,
                );
                return;
              }
              notify("Cadastro atualizado.");
              setEditing(false);
            }}
          >
            <Field label="Nome completo" name="name" defaultValue={person.name} required />
            <Field
              label="WhatsApp / telefone"
              name="phone"
              type="tel"
              defaultValue={person.phone}
              pattern="[\+\(\)\d\s\-]{10,20}"
              required
            />
            <Field label="E-mail" name="email" type="email" defaultValue={person.email} />
            <Field label="Cidade" name="city" defaultValue={person.city} required />
            <Field label="Preferências de contato" name="notes" defaultValue={person.notes} />
            <Button type="submit" className="w-full">
              Salvar cadastro
            </Button>
          </form>
        </Overlay>
      )}
      {document && (
        <Overlay title={document} onClose={() => setDocument(null)}>
          <div className="print-report space-y-4 text-sm leading-relaxed">
            <Badge>Documento demonstrativo · sem validade clínica</Badge>
            <h3 className="font-semibold">{document}</h3>
            <p>Paciente: {person.name}</p>
            <p>Clínica Odontológica Sidney Almeida · Patos de Minas, MG</p>
            <p>Registro de 12 set 2026 · Dr. Sidney Almeida</p>
            <p>
              {document.includes("Afastamento")
                ? "Registro fictício de afastamento por 1 dia após procedimento odontológico."
                : document.includes("Consentimento")
                  ? "Registro demonstrativo de consentimento informado, assinado em 09 set 2026."
                  : document.includes("Prescrição")
                    ? "Consulte os registros de medicação na ficha. Este documento demonstrativo não é uma prescrição."
                    : "Registro fictício de comparecimento para atendimento odontológico."}
            </p>
            <p className="text-xs text-muted-foreground">
              Documento ilustrativo, sem assinatura e sem validade legal.
            </p>
          </div>
          <Button className="mt-5 print:hidden" onClick={() => window.print()}>
            Imprimir / Salvar PDF
          </Button>
        </Overlay>
      )}
    </>
  );
}
