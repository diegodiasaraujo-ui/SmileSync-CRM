import { useEffect, useMemo, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type SetURLSearchParams,
} from "react-router";
import {
  Plus,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  ArrowRight,
  Check,
  Clock3,
  CalendarDays,
  Download,
  CreditCard,
  CheckCircle2,
  MoreHorizontal,
  CircleAlert,
} from "lucide-react";
import { useDemo } from "./store";
import {
  DEMO_DATE,
  activeAppointment,
  addDays,
  currency,
  shortDate,
  longDate,
  uid,
  professionalNames,
  type Appointment,
  type Treatment,
  type Quote,
  type Charge,
} from "./data";
import {
  Header,
  Button,
  Badge,
  Panel,
  Field,
  Select,
  Metric,
  Table,
  Avatar,
  IconButton,
  Overlay,
  Progress,
  Empty,
  inputClass,
  Toggle,
  Tabs,
} from "./ui";
import { ReportButton } from "./Reports";
import { FINANCE_MODULE_LABEL, TREATMENTS_MODULE_LABEL } from "./moduleLabels";

function useOperationalParams() {
  const [params, routerSetParams] = useSearchParams();
  const context = useLocation();
  const setParams: SetURLSearchParams = (next, options) =>
    routerSetParams(next, { state: context.state, ...options });
  return [params, setParams] as const;
}
function useSavedFilter(
  params: URLSearchParams,
  setParams: SetURLSearchParams,
  key: string,
  fallback = "",
) {
  return [
    params.get(key) || fallback,
    (value: string) =>
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        value ? next.set(key, value) : next.delete(key);
        return next;
      }),
  ] as const;
}

export function Agenda() {
  const { data, open, patient, update, notify, authMode, command } = useDemo();
  const availableProfessionals = professionalNames(data);
  const [params, setParams] = useOperationalParams();
  const date = params.get("data") || DEMO_DATE;
  const view = params.get("visao") || "Dia";
  const [professional, setProfessional] = useSavedFilter(params, setParams, "profissional");
  const [room, setRoom] = useSavedFilter(params, setParams, "sala");
  const [procedure, setProcedure] = useSavedFilter(params, setParams, "procedimento");
  const status = params.get("status") || "";
  const selected = data.appointments.find(
    (appointment) => appointment.id === params.get("consulta"),
  );
  const [move, setMove] = useState<{
    id: string;
    date: string;
    time: string;
  } | null>(null);
  const [drag, setDrag] = useState("");
  const [mobileFilters, setMobileFilters] = useState(false);
  const agendaColumns =
    availableProfessionals.length > 1
      ? [...availableProfessionals.slice(0, 2), "Sala 03"]
      : [availableProfessionals[0] || "Profissional", "Sala 02", "Sala 03"];
  const setParam = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      value ? next.set(key, value) : next.delete(key);
      return next;
    });
  const days =
    view === "Dia"
      ? [date]
      : Array.from({ length: view === "3 dias" ? 3 : 7 }, (_, index) => addDays(date, index));
  const filtered = data.appointments
    .filter(
      (appointment) =>
        days.includes(appointment.date) &&
        (!professional || appointment.professional === professional) &&
        (!room || appointment.room === room) &&
        (!procedure || appointment.procedure === procedure) &&
        (!status || appointment.status === status),
    )
    .sort((first, second) => first.time.localeCompare(second.time));
  const exportRows = filtered.map((appointment) => [
    patient(appointment.patientId).name,
    shortDate(appointment.date),
    appointment.time,
    appointment.procedure,
    appointment.professional,
    appointment.room,
    appointment.status,
  ]);
  const displayDate = `${date === DEMO_DATE ? "Hoje · " : ""}${longDate(date)}`;
  return (
    <>
      <Header
        title="Agenda"
        subtitle={`${filtered.length} agendamentos no período selecionado. Organize cada atendimento sem perder o contexto.`}
      >
        <ReportButton
          module="Agenda"
          headers={[
            "Paciente",
            "Data",
            "Horário",
            "Procedimento",
            "Profissional",
            "Sala",
            "Status",
          ]}
          rows={exportRows}
        />
        <Button onClick={() => open({ kind: "appointment", date })}>
          <Plus size={16} />
          Novo agendamento
        </Button>
      </Header>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label="Período anterior"
            onClick={() => setParam("data", addDays(date, -days.length))}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <label className="relative flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-medium focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <CalendarDays size={16} />
            <span className="hidden capitalize sm:inline">{displayDate}</span>
            <span className="sm:hidden">
              {date === DEMO_DATE ? "Hoje · " : ""}
              {shortDate(date)}
            </span>
            <input
              aria-label="Selecionar data da agenda"
              type="date"
              value={date}
              onChange={(event) => event.target.value && setParam("data", event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <IconButton
            label="Próximo período"
            onClick={() => setParam("data", addDays(date, days.length))}
          >
            <ChevronRight size={18} />
          </IconButton>
          <Button
            variant="ghost"
            className="hidden sm:inline-flex"
            onClick={() => setParam("data", DEMO_DATE)}
          >
            Hoje
          </Button>
        </div>
        <div className="flex rounded-lg border border-border bg-white p-1">
          {["Dia", "3 dias", "Semana"].map((item) => (
            <button
              key={item}
              onClick={() => setParam("visao", item)}
              aria-pressed={view === item}
              className={`rounded-md px-3 py-2 text-xs font-medium ${
                view === item ? "bg-secondary text-primary" : "text-muted-foreground"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <Button
        variant="secondary"
        className="mb-4 sm:hidden"
        aria-expanded={mobileFilters}
        onClick={() => setMobileFilters(!mobileFilters)}
      >
        {mobileFilters ? "Ocultar filtros" : "Filtrar agenda"}
      </Button>
      <div
        className={`mb-5 gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-4 ${
          mobileFilters ? "grid" : "hidden"
        }`}
      >
        <Select
          label="Profissional"
          value={professional}
          onChange={(event) => setProfessional(event.target.value)}
        >
          <option value="">Todos os profissionais</option>
          {availableProfessionals.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select label="Sala" value={room} onChange={(event) => setRoom(event.target.value)}>
          <option value="">Todas as salas</option>
          {["Sala 01", "Sala 02", "Sala 03"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select
          label="Procedimento"
          value={procedure}
          onChange={(event) => setProcedure(event.target.value)}
        >
          <option value="">Todos os procedimentos</option>
          {Array.from(new Set(data.appointments.map((item) => item.procedure))).map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select
          label="Status"
          value={status}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="">Todos os status</option>
          {[
            "Confirmado",
            "Aguardando confirmação",
            "Em atendimento",
            "Concluído",
            "Faltou",
            "Encaixe",
            "Cancelado",
            "Remarcado",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
      </div>
      <Panel className="sm:hidden">
        {days.map((day) => (
          <section key={day}>
            <h2 className="border-b border-border bg-muted px-4 py-3 text-sm font-medium">
              {shortDate(day)} · {day === DEMO_DATE ? "Hoje" : longDate(day).split(",")[0]}
            </h2>
            {filtered
              .filter((appointment) => appointment.date === day)
              .map((appointment) => (
                <button
                  key={appointment.id}
                  onClick={() => setParam("consulta", appointment.id)}
                  className="flex w-full gap-3 border-b border-border p-4 text-left"
                >
                  <span className="text-sm font-semibold tabular-nums">
                    {appointment.time}
                    <small className="mt-1 block text-xs font-normal text-muted-foreground">
                      {appointment.duration} min
                    </small>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {patient(appointment.patientId).name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {appointment.procedure}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {appointment.professional} · {appointment.room}
                    </span>
                    <span className="mt-2 inline-block">
                      <Badge>{appointment.status}</Badge>
                    </span>
                    {patient(appointment.patientId).city !== "Patos de Minas" && (
                      <span className="mt-1 block text-xs text-blue-700">
                        Outra cidade · {patient(appointment.patientId).city}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={16} className="mt-1 text-muted-foreground" />
                </button>
              ))}
          </section>
        ))}
      </Panel>
      <Panel className="hidden sm:block">
        <div className="overflow-x-auto">
          <div
            className={`grid divide-x divide-border ${
              days.length > 1 ? "min-w-[750px]" : "min-w-[650px]"
            }`}
            style={{
              gridTemplateColumns: `64px repeat(${
                days.length === 1 ? 3 : days.length
              }, minmax(0, 1fr))`,
            }}
          >
            <div className="border-b border-border bg-muted/60 px-2 py-4 text-[11px] text-muted-foreground">
              Horário
            </div>
            {(days.length === 1
              ? agendaColumns
              : days.map(
                  (item) =>
                    `${shortDate(item)} · ${new Date(`${item}T12:00`).toLocaleDateString("pt-BR", { weekday: "short" })}`,
                )
            ).map((item) => (
              <div
                key={item}
                className="border-b border-border bg-muted/60 px-3 py-4 text-xs font-medium"
              >
                {item}
              </div>
            ))}
            {Array.from({ length: 20 }, (_, index) => {
              const time = `${String(8 + Math.floor(index / 2)).padStart(2, "0")}:${
                index % 2 ? "30" : "00"
              }`;
              return (
                <div key={time} className="contents">
                  <div className="flex min-h-[66px] items-start justify-center border-b border-border/60 pt-2 text-[11px] tabular-nums text-muted-foreground">
                    {time}
                  </div>
                  {Array.from({ length: days.length === 1 ? 3 : days.length }, (_, column) => {
                    const targetDate = days.length === 1 ? date : days[column];
                    const cellAppointments = filtered.filter(
                      (item) =>
                        item.date === targetDate &&
                        (days.length > 1 ||
                          (item.professional === availableProfessionals[0]
                            ? item.room === "Sala 03"
                              ? 2
                              : 0
                            : 1) === column) &&
                        item.time.slice(0, 2) === time.slice(0, 2) &&
                        Math.floor(Number(item.time.slice(3, 5)) / 30) ===
                          Math.floor(Number(time.slice(3, 5)) / 30),
                    );
                    return (
                      <div
                        key={column}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (drag) setMove({ id: drag, date: targetDate, time });
                          setDrag("");
                        }}
                        className="min-h-[66px] border-b border-border/60 p-1.5 transition-colors hover:bg-muted/30"
                      >
                        {cellAppointments.length ? (
                          cellAppointments.map((item) => (
                            <button
                              draggable={activeAppointment(item)}
                              onDragStart={() => setDrag(item.id)}
                              key={item.id}
                              onClick={() => setParam("consulta", item.id)}
                              className={`mb-1 w-full rounded-lg border-l-[3px] p-2.5 text-left ${
                                item.status === "Cancelado"
                                  ? "border-red-400 bg-red-50/70"
                                  : item.status === "Aguardando confirmação"
                                    ? "border-amber-500 bg-amber-50/70"
                                    : item.status === "Concluído"
                                      ? "border-slate-400 bg-muted"
                                      : "border-primary bg-accent/70"
                              }`}
                            >
                              <span className="block text-xs font-medium">
                                {patient(item.patientId).name}
                              </span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">
                                {item.procedure}
                              </span>
                              <span className="mt-1 block text-[11px] text-muted-foreground">
                                {item.time} · {item.duration} min · {item.room}
                              </span>
                              <span className="mt-2 inline-block">
                                <Badge>{item.status}</Badge>
                              </span>
                              {patient(item.patientId).city !== "Patos de Minas" && (
                                <span className="mt-1 block text-[11px] text-blue-700">
                                  Outra cidade · {patient(item.patientId).city}
                                </span>
                              )}
                            </button>
                          ))
                        ) : (
                          <button
                            className="group flex min-h-12 w-full items-center justify-center rounded-md text-muted-foreground/0 hover:bg-secondary hover:text-primary focus:text-primary"
                            aria-label={`Agendar ${shortDate(targetDate)} às ${time}`}
                            onClick={() =>
                              open({
                                kind: "appointment",
                                date: targetDate,
                                time,
                              })
                            }
                          >
                            <Plus size={15} className="group-focus-visible:text-primary" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
      <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
        Clique em um atendimento para abrir os detalhes. Arraste para outro horário e confirme a
        alteração.
      </p>
      {filtered.length === 0 && (
        <Empty
          title="Nenhum agendamento neste período"
          text="Crie uma consulta ou ajuste os filtros."
          action={
            <Button
              onClick={async () => {
                const next = new URLSearchParams(params);
                for (const key of ["profissional", "sala", "procedimento", "status"])
                  next.delete(key);
                setParams(next);
              }}
            >
              Limpar filtros
            </Button>
          }
        />
      )}
      {selected && (
        <AppointmentDrawer appointment={selected} close={() => setParam("consulta", "")} />
      )}
      {move && (
        <Overlay title="Alterar horário da consulta?" onClose={() => setMove(null)}>
          <p className="text-sm leading-relaxed">
            A consulta de{" "}
            <strong>
              {patient(data.appointments.find((item) => item.id === move.id)!.patientId).name}
            </strong>{" "}
            será remarcada para {shortDate(move.date)}, às {move.time}.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMove(null)}>
              Voltar
            </Button>
            <Button
              onClick={async () => {
                const moved = data.appointments.find((item) => item.id === move.id)!;
                const minutes = (time: string) =>
                  Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]);
                const start = minutes(move.time);
                if (
                  data.appointments.some(
                    (item) =>
                      item.id !== moved.id &&
                      item.date === move.date &&
                      item.status !== "Cancelado" &&
                      (item.professional === moved.professional || item.room === moved.room) &&
                      start < minutes(item.time) + item.duration &&
                      start + moved.duration > minutes(item.time),
                  )
                ) {
                  notify("Horário indisponível: há conflito de sala ou profissional.", true);
                  return;
                }
                const before = { ...moved };
                try {
                  if (authMode === "authenticated")
                    await command("appointment.reschedule", {
                      appointmentId: move.id,
                      date: move.date,
                      time: move.time,
                    });
                  else
                    update((previous) => ({
                      ...previous,
                      appointments: previous.appointments.map((item) =>
                        item.id === move.id
                          ? {
                              ...item,
                              date: move.date,
                              time: move.time,
                              status: "Remarcado",
                            }
                          : item,
                      ),
                      interactions: [
                        {
                          id: uid(),
                          patientId: moved.patientId,
                          date: new Date().toISOString(),
                          title: "Consulta remarcada na agenda",
                          text: `${move.date} · ${move.time}`,
                          kind: "Agenda",
                        },
                        ...previous.interactions,
                      ],
                    }));
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : "Não foi possível remarcar.",
                    true,
                  );
                  return;
                }
                notify(
                  "Horário alterado.",
                  false,
                  authMode === "demo"
                    ? () =>
                        update((previous) => ({
                          ...previous,
                          appointments: previous.appointments.map((item) =>
                            item.id === before.id ? before : item,
                          ),
                        }))
                    : undefined,
                );
                setMove(null);
              }}
            >
              Confirmar alteração
            </Button>
          </div>
        </Overlay>
      )}
    </>
  );
}
function AppointmentDrawer({
  appointment,
  close,
}: {
  appointment: Appointment;
  close: () => void;
}) {
  const { patient, open, update, notify, record, authMode, command } = useDemo();
  const navigate = useNavigate();
  const [cancel, setCancel] = useState(false);
  const person = patient(appointment.patientId);
  const statusChange = async (status: string) => {
    try {
      if (authMode === "authenticated")
        await command("appointment.status", {
          appointmentId: appointment.id,
          status,
        });
      else {
        update((previous) => ({
          ...previous,
          appointments: previous.appointments.map((item) =>
            item.id === appointment.id ? { ...item, status } : item,
          ),
        }));
        record(
          person.id,
          `Consulta: ${status.toLowerCase()}`,
          `${appointment.procedure} · ${appointment.time}`,
          "Agenda",
        );
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Não foi possível atualizar a consulta.",
        true,
      );
      return;
    }
    notify(
      `Consulta marcada como ${status.toLowerCase()}.`,
      false,
      status === "Cancelado" && authMode === "demo"
        ? () =>
            update((previous) => ({
              ...previous,
              appointments: previous.appointments.map((item) =>
                item.id === appointment.id ? { ...item, status: appointment.status } : item,
              ),
            }))
        : undefined,
    );
    setCancel(false);
    if (status === "Cancelado") close();
  };
  return (
    <Overlay title="Detalhes do agendamento" onClose={close} drawer>
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={person.name} size="large" />
        <div>
          <h3 className="text-lg font-semibold">{person.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{appointment.procedure}</p>
        </div>
      </div>
      <Badge>{appointment.status}</Badge>
      <dl className="my-6 grid grid-cols-2 gap-5 text-sm">
        {[
          ["Data", shortDate(appointment.date)],
          ["Horário", `${appointment.time} · ${appointment.duration} min`],
          ["Profissional", appointment.professional],
          ["Sala", appointment.room],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {person.city !== "Patos de Minas" && (
        <div className="mb-5 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
          Outra cidade · {person.city} → Patos de Minas
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            navigate(`/app/pacientes/${person.id}`, {
              state: { returnTo: `/app/agenda?data=${appointment.date}` },
            })
          }
        >
          Abrir paciente
          <ArrowRight size={14} />
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            close();
            open({ kind: "message", patientId: person.id });
          }}
        >
          <MessageCircle size={16} />
          WhatsApp
        </Button>
      </div>
      <Select
        label="Status do atendimento"
        value={appointment.status}
        onChange={(event) =>
          event.target.value === "Cancelado" ? setCancel(true) : statusChange(event.target.value)
        }
      >
        {[
          "Confirmado",
          "Aguardando confirmação",
          "Em atendimento",
          "Concluído",
          "Faltou",
          "Encaixe",
          "Cancelado",
          "Remarcado",
        ].map((status) => (
          <option key={status}>{status}</option>
        ))}
      </Select>
      {appointment.status === "Concluído" && (
        <div className="my-4 rounded-lg bg-secondary p-4">
          <p className="mb-3 text-sm font-medium">Continue o atendimento</p>
          <Button
            onClick={() => {
              close();
              open({ kind: "note", patientId: person.id });
            }}
          >
            Registrar evolução
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              close();
              open({ kind: "appointment", patientId: person.id });
            }}
          >
            Agendar retorno
          </Button>
          {appointment.treatmentId && (
            <Button
              variant="ghost"
              onClick={() => navigate(`/app/tratamentos/${appointment.treatmentId}`)}
            >
              Abrir tratamento
            </Button>
          )}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          onClick={() => statusChange("Confirmado")}
          disabled={
            appointment.status === "Confirmado" ||
            appointment.status === "Cancelado" ||
            appointment.status === "Concluído"
          }
        >
          <Check size={15} />
          Confirmar
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            close();
            open({
              kind: "appointment",
              patientId: person.id,
              appointmentId: appointment.id,
            });
          }}
        >
          Remarcar
        </Button>
        <Button
          variant="danger"
          disabled={appointment.status === "Cancelado"}
          onClick={() => setCancel(true)}
        >
          Cancelar consulta
        </Button>
      </div>
      {cancel && (
        <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Cancelar consulta de {person.name}?</p>
          <p className="mt-2 text-xs leading-relaxed text-red-700">
            Ela ficará marcada como cancelada. O registro continuará disponível no histórico.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => statusChange("Cancelado")}>
              Confirmar cancelamento
            </Button>
            <Button variant="secondary" onClick={() => setCancel(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </Overlay>
  );
}
export function Treatments({ patientId }: { patientId?: string }) {
  const { data, patient, canFinance, open } = useDemo();
  const availableProfessionals = professionalNames(data);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useOperationalParams();
  const [query, setQuery] = useSavedFilter(params, setParams, "busca-tratamento");
  const [professional, setProfessional] = useSavedFilter(params, setParams, "profissional");
  const [status, setStatus] = useSavedFilter(params, setParams, "estado-tratamento");
  const list = data.treatments.filter(
    (treatment) =>
      (!patientId || treatment.patientId === patientId) &&
      (!query ||
        `${treatment.name} ${patient(treatment.patientId).name}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!professional || treatment.professional === professional) &&
      (!status || treatment.status === status) &&
      (params.get("filtro") !== "sem-retorno" ||
        !data.appointments.some(
          (appointment) =>
            appointment.treatmentId === treatment.id &&
            appointment.date >= DEMO_DATE &&
            activeAppointment(appointment),
        )),
  );
  const paid = (id: string) =>
    data.charges
      .filter((charge) => charge.treatmentId === id && charge.paid)
      .reduce((sum, charge) => sum + charge.value, 0);
  return (
    <>
      {!patientId && (
        <Header
          title={TREATMENTS_MODULE_LABEL}
          subtitle="Etapas, continuidade clínica e próxima ação de cada paciente."
        >
          <ReportButton
            module={TREATMENTS_MODULE_LABEL}
            headers={["Paciente", "Tratamento", "Profissional", "Etapas concluídas", "Status"]}
            rows={list.map((treatment) => [
              patient(treatment.patientId).name,
              treatment.name,
              treatment.professional,
              `${treatment.steps.filter((step) => step.done).length}/${treatment.steps.length}`,
              treatment.status,
            ])}
          />
          <Button onClick={() => open({ kind: "treatment" })}>
            <Plus size={16} />
            Novo tratamento
          </Button>
        </Header>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Field
            label="Buscar tratamento ou paciente"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome ou procedimento"
          />
        </div>
        <Select
          label="Profissional"
          value={professional}
          onChange={(event) => setProfessional(event.target.value)}
        >
          <option value="">Todos</option>
          {availableProfessionals.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos</option>
          {[
            "Planejamento",
            "Aguardando aprovação",
            "Aguardando pagamento",
            "Agendado",
            "Em andamento",
            "Aguardando retorno",
            "Pausado",
            "Concluído",
            "Cancelado",
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        {patientId && (
          <Button onClick={() => open({ kind: "treatment", patientId })}>
            <Plus size={15} />
            Adicionar
          </Button>
        )}
      </div>
      {params.get("filtro") && (
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() =>
            setParams((previous) => {
              previous.delete("filtro");
              return previous;
            })
          }
        >
          Sem retorno ativo · Limpar filtro ×
        </Button>
      )}
      <Panel>
        {list.length ? (
          <Table
            headers={[
              "Paciente / tratamento",
              "Profissional",
              ...(canFinance ? ["Contratado / pago", "Em aberto"] : []),
              "Etapas",
              "Próxima etapa",
              "Status",
              "",
            ]}
          >
            {list.map((treatment) => (
              <tr key={treatment.id}>
                <td>
                  <button
                    className="text-left"
                    onClick={() =>
                      navigate(`/app/tratamentos/${treatment.id}`, {
                        state: {
                          returnTo: location.pathname + location.search,
                        },
                      })
                    }
                  >
                    <strong className="font-medium hover:text-primary">{treatment.name}</strong>
                    <small className="mt-1 block text-xs text-muted-foreground">
                      {patient(treatment.patientId).name}
                    </small>
                  </button>
                </td>
                <td className="text-xs">
                  {treatment.professional}
                  <div className="mt-1">
                    <Badge>{treatment.priority} prioridade</Badge>
                  </div>
                </td>
                {canFinance && (
                  <>
                    <td className="tabular-nums">
                      {currency(treatment.total)}
                      <small className="mt-1 block text-xs text-muted-foreground">
                        {currency(paid(treatment.id))} pagos
                      </small>
                    </td>
                    <td className="tabular-nums">
                      {currency(treatment.total - paid(treatment.id))}
                    </td>
                  </>
                )}
                <td>
                  <Progress
                    done={treatment.steps.filter((step) => step.done).length}
                    total={treatment.steps.length}
                  />
                </td>
                <td className="text-xs">
                  {treatment.steps.find((step) => !step.done)?.name || "Todas concluídas"}
                  <small className="mt-1 block text-muted-foreground">
                    {shortDate(treatment.steps.find((step) => !step.done)?.date || "")}
                  </small>
                </td>
                <td>
                  <Badge>{treatment.status}</Badge>
                </td>
                <td>
                  <IconButton
                    label="Abrir tratamento"
                    onClick={() =>
                      navigate(`/app/tratamentos/${treatment.id}`, {
                        state: {
                          returnTo: location.pathname + location.search,
                        },
                      })
                    }
                  >
                    <ChevronRight size={17} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum tratamento encontrado"
            text="Revise os filtros ou adicione um tratamento à ficha do paciente."
            action={
              <Button onClick={() => open({ kind: "treatment", patientId })}>
                Adicionar tratamento
              </Button>
            }
          />
        )}
      </Panel>
    </>
  );
}
export function TreatmentDetail() {
  const { id } = useParams();
  const { data, patient, update, open, canFinance, notify, record, authMode, command } = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const treatment = data.treatments.find((item) => item.id === id);
  const [confirm, setConfirm] = useState(false);
  if (!treatment)
    return (
      <Empty
        title="Tratamento não encontrado"
        action={
          <Button onClick={() => navigate("/app/tratamentos")}>
            Ver {TREATMENTS_MODULE_LABEL}
          </Button>
        }
      />
    );
  const person = patient(treatment.patientId);
  const done = treatment.steps.filter((step) => step.done).length;
  const next = treatment.steps.find((step) => !step.done);
  const paid = data.charges
    .filter((charge) => charge.treatmentId === id && charge.paid)
    .reduce((sum, charge) => sum + charge.value, 0);
  const changeStatus = async (status: string) => {
    if (status === "Cancelado") {
      setConfirm(true);
      return;
    }
    if (status === "Concluído" && done !== treatment.steps.length) {
      notify("Conclua as etapas antes de finalizar o tratamento.", true);
      return;
    }
    try {
      if (authMode === "authenticated")
        await command("treatment.update", { treatmentId: id, status });
      else {
        update((previous) => ({
          ...previous,
          treatments: previous.treatments.map((item) =>
            item.id === id ? { ...item, status } : item,
          ),
        }));
        record(person.id, `Tratamento: ${status.toLowerCase()}`, treatment.name, "Clínico");
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Não foi possível atualizar o tratamento.",
        true,
      );
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        className="mb-4 -ml-3"
        onClick={() => navigate(location.state?.returnTo || "/app/tratamentos")}
      >
        <ChevronLeft size={16} />
        Voltar ao contexto anterior
      </Button>
      <Header title={treatment.name} subtitle={`${person.name} · ${treatment.professional}`}>
        <Button
          variant="secondary"
          onClick={() =>
            navigate(`/app/pacientes/${person.id}`, {
              state: { returnTo: location.pathname },
            })
          }
        >
          Abrir paciente
          <ArrowRight size={16} />
        </Button>
        <Button onClick={() => open({ kind: "note", patientId: person.id })}>
          <Plus size={16} />
          Registrar evolução
        </Button>
      </Header>
      {canFinance && (
        <div className="mb-6 grid grid-cols-1 divide-border rounded-xl border border-border bg-white sm:grid-cols-3 sm:divide-x">
          <Metric
            label="Valor contratado"
            value={currency(treatment.total)}
            detail="Plano de tratamento aprovado"
          />
          <Metric label="Valor pago" value={currency(paid)} detail="Pagamentos registrados" />
          <Metric
            label="Valor em aberto"
            value={currency(treatment.total - paid)}
            detail="Saldo atualizado do tratamento"
          />
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          title="Etapas do tratamento"
          subtitle="Progresso calculado por etapas realmente concluídas"
        >
          <div className="px-5 pb-5">
            <Progress done={done} total={treatment.steps.length} />
            <ol className="mt-5 divide-y divide-border">
              {treatment.steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3 py-4">
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${
                      step.done
                        ? "bg-primary text-white"
                        : index === done
                          ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {step.done ? <Check size={14} /> : index + 1}
                  </span>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium">{step.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {shortDate(step.date)}
                      {step.done ? " · Concluída" : index === done ? " · Próxima etapa" : ""}
                    </p>
                  </div>
                  {!step.done && index === done && treatment.status !== "Cancelado" && (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          if (authMode === "authenticated")
                            await command("treatment.step.complete", {
                              treatmentId: treatment.id,
                              stepIndex: index,
                            });
                          else
                            update((previous) => ({
                              ...previous,
                              treatments: previous.treatments.map((item) =>
                                item.id === treatment.id
                                  ? {
                                      ...item,
                                      status:
                                        done + 1 === item.steps.length
                                          ? "Concluído"
                                          : "Em andamento",
                                      steps: item.steps.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? {
                                              ...entry,
                                              done: true,
                                              date: DEMO_DATE,
                                            }
                                          : entry,
                                      ),
                                    }
                                  : item,
                              ),
                            }));
                          if (authMode === "demo")
                            record(person.id, "Etapa concluída", step.name, "Clínico");
                        } catch (error) {
                          notify(
                            error instanceof Error
                              ? error.message
                              : "Não foi possível concluir a etapa.",
                            true,
                          );
                          return;
                        }
                        notify("Etapa concluída. Próxima ação atualizada.");
                      }}
                    >
                      Concluir
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </Panel>
        <div className="space-y-5">
          <section className="rounded-xl bg-secondary p-5">
            <p className="text-xs font-medium text-primary">PRÓXIMA AÇÃO</p>
            <h2 className="mt-3 text-base font-semibold">
              {next?.name || "Tratamento finalizado"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {next
                ? next.date
                  ? `Etapa prevista para ${shortDate(next.date)}. Confirme o atendimento e registre a evolução clínica.`
                  : "Esta etapa ainda não tem data. Entre em contato para organizar a continuidade do tratamento."
                : "Todas as etapas foram registradas como concluídas."}
            </p>
            {next && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => open({ kind: "appointment", patientId: person.id })}>
                  <CalendarPlus size={16} />
                  Agendar retorno
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => open({ kind: "message", patientId: person.id })}
                >
                  <MessageCircle size={16} />
                  WhatsApp
                </Button>
              </div>
            )}
          </section>
          <Panel title="Acompanhamento">
            <div className="space-y-4 px-5 pb-5">
              {canFinance &&
                !data.charges.some((charge) => charge.treatmentId === treatment.id) && (
                  <form
                    className="space-y-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget);
                      const total = Number(fields.get("total"));
                      try {
                        if (authMode === "authenticated")
                          await command("treatment.update", {
                            treatmentId: treatment.id,
                            total,
                          });
                        else
                          update((previous) => ({
                            ...previous,
                            treatments: previous.treatments.map((item) =>
                              item.id === treatment.id ? { ...item, total } : item,
                            ),
                          }));
                      } catch (error) {
                        notify(
                          error instanceof Error
                            ? error.message
                            : "Não foi possível atualizar o valor.",
                          true,
                        );
                        return;
                      }
                      notify("Valor contratado atualizado. Você pode criar o plano financeiro.");
                    }}
                  >
                    <Field
                      label="Valor contratado (R$)"
                      name="total"
                      type="number"
                      min="0.01"
                      step="0.01"
                      defaultValue={treatment.total}
                      required
                    />
                    <Button type="submit" variant="secondary">
                      Salvar valor contratado
                    </Button>
                  </form>
                )}
              <Select
                label="Status do tratamento"
                value={treatment.status}
                onChange={(event) => changeStatus(event.target.value)}
              >
                {[
                  "Planejamento",
                  "Aguardando aprovação",
                  "Aguardando pagamento",
                  "Agendado",
                  "Em andamento",
                  "Aguardando retorno",
                  "Pausado",
                  "Concluído",
                  "Cancelado",
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </Select>
              <Select
                label="Prioridade"
                value={treatment.priority}
                onChange={async (event) => {
                  const priority = event.target.value;
                  try {
                    if (authMode === "authenticated")
                      await command("treatment.update", {
                        treatmentId: id,
                        priority,
                      });
                    else
                      update((previous) => ({
                        ...previous,
                        treatments: previous.treatments.map((item) =>
                          item.id === id ? { ...item, priority } : item,
                        ),
                      }));
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Não foi possível atualizar a prioridade.",
                      true,
                    );
                  }
                }}
              >
                {["Alta", "Média", "Baixa"].map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </Select>
              {canFinance && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate(`/app/financeiro?paciente=${person.id}`)}
                >
                  Ver plano financeiro
                  <ArrowRight size={15} />
                </Button>
              )}
            </div>
          </Panel>
          <Panel title="Contexto clínico">
            <div className="px-5 pb-5 text-sm leading-relaxed">
              <p className="text-muted-foreground">
                {person.id === "mariana-oliveira"
                  ? "Pós-operatório sem intercorrências. Medicações, atestado e consentimento disponíveis na ficha."
                  : person.notes}
              </p>
              <Button
                variant="ghost"
                className="mt-2 -ml-3"
                onClick={() =>
                  navigate(`/app/pacientes/${person.id}?aba=Documentos`, {
                    state: { returnTo: location.pathname },
                  })
                }
              >
                Abrir documentos
                <ArrowRight size={14} />
              </Button>
            </div>
          </Panel>
        </div>
      </div>
      {confirm && (
        <Overlay title="Cancelar tratamento?" onClose={() => setConfirm(false)}>
          <p className="text-sm">
            O tratamento de {person.name} ficará cancelado. Etapas e pagamentos serão preservados
            para consulta.
          </p>
          <div className="mt-5 flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  if (authMode === "authenticated")
                    await command("treatment.update", {
                      treatmentId: id,
                      status: "Cancelado",
                    });
                  else {
                    update((previous) => ({
                      ...previous,
                      treatments: previous.treatments.map((item) =>
                        item.id === id ? { ...item, status: "Cancelado" } : item,
                      ),
                    }));
                    record(person.id, "Tratamento cancelado", treatment.name, "Clínico");
                  }
                } catch (error) {
                  notify(
                    error instanceof Error
                      ? error.message
                      : "Não foi possível cancelar o tratamento.",
                    true,
                  );
                  return;
                }
                setConfirm(false);
                notify("Tratamento cancelado.");
              }}
            >
              Cancelar tratamento
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Voltar
            </Button>
          </div>
        </Overlay>
      )}
    </>
  );
}
export function Quotes({ patientId }: { patientId?: string }) {
  const { data, patient, update, canFinance, open, notify, record, authMode, command } = useDemo();
  const availableProfessionals = professionalNames(data);
  const navigate = useNavigate();
  const [params, setParams] = useOperationalParams();
  const [status, setStatus] = useSavedFilter(params, setParams, "estado-orcamento");
  const [selected, setSelected] = useState<string | null>(null);
  const quote = data.quotes.find((item) => item.id === selected);
  const rows = data.quotes.filter(
    (item) => (!patientId || item.patientId === patientId) && (!status || item.status === status),
  );
  if (!canFinance) return <AccessDenied />;
  const changeStatus = async (item: Quote, status: string) => {
    if (item.treatmentId) {
      notify("Este orçamento já foi convertido em tratamento.", true);
      return;
    }
    try {
      if (authMode === "authenticated") await command("quote.status", { quoteId: item.id, status });
      else {
        update((previous) => ({
          ...previous,
          quotes: previous.quotes.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status,
                  ...(status === "Enviado" ? { sent: DEMO_DATE } : {}),
                  ...(status === "Aprovado" ? { approved: DEMO_DATE } : {}),
                }
              : entry,
          ),
        }));
        record(item.patientId, `Orçamento ${status.toLowerCase()}`, item.procedure, "Orçamento");
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Não foi possível atualizar o orçamento.",
        true,
      );
      return;
    }
    notify(`Orçamento ${status.toLowerCase()}.`);
  };
  const convert = async (item: Quote) => {
    if (item.treatmentId || item.status !== "Aprovado") return;
    let id: string = uid();
    const total = item.value - item.discount;
    try {
      if (authMode === "authenticated") {
        const result = await command<{ id: string }>("quote.convert", {
          quoteId: item.id,
        });
        id = result.id;
      } else {
        update((previous) => ({
          ...previous,
          quotes: previous.quotes.map((entry) =>
            entry.id === item.id ? { ...entry, treatmentId: id } : entry,
          ),
          treatments: [
            ...previous.treatments,
            {
              id,
              patientId: item.patientId,
              name: item.procedure,
              professional: availableProfessionals[0] || data.account.name,
              total,
              status: "Planejamento",
              priority: "Média",
              steps: ["Avaliação", "Planejamento", "Procedimento", "Retorno", "Finalização"].map(
                (name) => ({ name, date: "", done: false }),
              ),
            },
          ],
        }));
        record(item.patientId, "Orçamento convertido em tratamento", item.procedure, "Clínico");
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Não foi possível converter o orçamento.",
        true,
      );
      return;
    }
    notify("Tratamento criado. Configure as etapas e o plano financeiro.");
    navigate(`/app/tratamentos/${id}`);
  };
  return (
    <>
      {!patientId && (
        <Header
          title="Orçamentos"
          subtitle="Da proposta ao tratamento, sem perder o contexto do paciente."
        >
          <ReportButton
            module="Orçamentos"
            headers={["Paciente", "Procedimento", "Valor final", "Validade", "Status"]}
            rows={rows.map((item) => [
              patient(item.patientId).name,
              item.procedure,
              currency(item.value - item.discount),
              shortDate(item.validity),
              item.status,
            ])}
          />
          <Button onClick={() => open({ kind: "quote" })}>
            <Plus size={16} />
            Novo orçamento
          </Button>
        </Header>
      )}
      <div className="mb-4 flex items-end justify-between gap-3">
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos os orçamentos</option>
          {["Rascunho", "Enviado", "Visualizado", "Aprovado", "Recusado", "Expirado"].map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </Select>
        {patientId && (
          <Button onClick={() => open({ kind: "quote", patientId })}>
            <Plus size={15} />
            Criar orçamento
          </Button>
        )}
      </div>
      <Panel>
        {rows.length ? (
          <Table
            headers={[
              "Paciente / procedimento",
              "Valor",
              "Desconto",
              "Valor final",
              "Validade",
              "Enviado / aprovado",
              "Status",
              "",
            ]}
          >
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <button className="text-left" onClick={() => setSelected(item.id)}>
                    <span className="font-medium">{patient(item.patientId).name}</span>
                    <small className="mt-1 block text-xs text-muted-foreground">
                      {item.procedure}
                    </small>
                  </button>
                </td>
                <td>{currency(item.value)}</td>
                <td>{currency(item.discount)}</td>
                <td className="font-medium">{currency(item.value - item.discount)}</td>
                <td>{shortDate(item.validity)}</td>
                <td className="text-xs text-muted-foreground">
                  {item.sent ? shortDate(item.sent) : "Não enviado"}
                  <small className="mt-1 block">
                    {item.approved ? shortDate(item.approved) : "Não aprovado"}
                  </small>
                </td>
                <td>
                  <Badge>{item.status}</Badge>
                </td>
                <td>
                  <Button variant="ghost" onClick={() => setSelected(item.id)}>
                    Detalhes
                    <ChevronRight size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhum orçamento encontrado"
            action={
              <Button onClick={() => open({ kind: "quote", patientId })}>Criar orçamento</Button>
            }
          />
        )}
      </Panel>
      {quote && (
        <Overlay title="Detalhes do orçamento" onClose={() => setSelected(null)} drawer>
          <p className="text-lg font-semibold">{patient(quote.patientId).name}</p>
          <p className="mt-2 text-sm text-muted-foreground">{quote.procedure}</p>
          <p className="my-5 text-3xl font-semibold">
            {currency(quote.value - quote.discount, true)}
          </p>
          <Badge>{quote.status}</Badge>
          <p className="my-4 text-xs text-muted-foreground">
            Válido até {shortDate(quote.validity)} · Desconto: {currency(quote.discount)}
          </p>
          <div className="space-y-3">
            {quote.treatmentId ? (
              <Button
                className="w-full"
                onClick={() => navigate(`/app/tratamentos/${quote.treatmentId}`)}
              >
                Abrir tratamento
                <ArrowRight size={16} />
              </Button>
            ) : (
              <>
                <Select
                  label="Status da proposta"
                  value={quote.status}
                  onChange={(event) => changeStatus(quote, event.target.value)}
                >
                  {["Rascunho", "Enviado", "Visualizado", "Aprovado", "Recusado", "Expirado"].map(
                    (item) => (
                      <option key={item}>{item}</option>
                    ),
                  )}
                </Select>
                <Button
                  className="w-full"
                  disabled={quote.status !== "Aprovado"}
                  onClick={() => convert(quote)}
                >
                  Converter em tratamento
                  <ArrowRight size={16} />
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setSelected(null);
                open({
                  kind: "message",
                  patientId: quote.patientId,
                  text: `Olá, ${patient(quote.patientId).name.split(" ")[0]}! Seu orçamento de ${quote.procedure} é de ${currency(quote.value - quote.discount, true)}, válido até ${shortDate(quote.validity)}. Podemos conversar sobre o tratamento?`,
                });
              }}
            >
              <MessageCircle size={16} />
              Preparar envio por WhatsApp
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => navigate(`/app/pacientes/${quote.patientId}`)}
            >
              Abrir paciente
            </Button>
          </div>
        </Overlay>
      )}
    </>
  );
}
export function Finance({ patientId }: { patientId?: string }) {
  const { data, canFinance, patient, open, update, notify, authMode, command } = useDemo();
  const navigate = useNavigate();
  const [params, setParams] = useOperationalParams();
  const [tab, setTab] = useSavedFilter(params, setParams, "finance-tab", "Todos");
  const [start, setStart] = useSavedFilter(params, setParams, "de", `${DEMO_DATE.slice(0, 8)}01`);
  const [end, setEnd] = useSavedFilter(params, setParams, "ate", addDays(DEMO_DATE, 90));
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const personFilter = patientId || params.get("paciente") || "";
  const statusFilter = params.get("status") || "";
  const all = data.charges.filter((charge) => !personFilter || charge.patientId === personFilter);
  const chargeStatus = (charge: Charge) =>
    charge.paid
      ? "Pago"
      : charge.due < DEMO_DATE
        ? "Vencido"
        : charge.due <= addDays(DEMO_DATE, 3)
          ? "Vencendo"
          : "Em dia";
  const filtered = all.filter(
    (charge) =>
      charge.due >= start &&
      charge.due <= end &&
      (!statusFilter || chargeStatus(charge) === statusFilter) &&
      (tab === "Todos" ||
        (tab === "Recebidos" && charge.paid) ||
        (tab === "A receber" && !charge.paid) ||
        (tab === "Vencidos" && chargeStatus(charge) === "Vencido")),
  );
  const selectedCharge = data.charges.find((charge) => charge.id === selected);
  const inPeriod = all.filter((charge) => charge.due >= start && charge.due <= end);
  const sum = (items: Charge[]) => items.reduce((total, item) => total + item.value, 0);
  const treatments = data.treatments.filter(
    (item) =>
      (!personFilter || item.patientId === personFilter) &&
      !data.charges.some((charge) => charge.treatmentId === item.id),
  );
  if (!canFinance) return <AccessDenied />;
  return (
    <>
      {!patientId && (
        <Header
          title={FINANCE_MODULE_LABEL}
          subtitle="Recebimentos, parcelas e cobranças conectados ao paciente."
        >
          <ReportButton
            module={FINANCE_MODULE_LABEL}
            headers={["Paciente", "Descrição", "Valor", "Vencimento", "Status", "Pagamento"]}
            rows={filtered.map((charge) => [
              patient(charge.patientId).name,
              charge.title,
              currency(charge.value, true),
              shortDate(charge.due),
              chargeStatus(charge),
              charge.method || "—",
            ])}
          />
          <Button onClick={() => open({ kind: "payment", patientId: personFilter || undefined })}>
            <Plus size={16} />
            Registrar pagamento
          </Button>
        </Header>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Field
          label="De"
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
        <Field
          label="Até"
          type="date"
          value={end}
          min={start}
          onChange={(event) => setEnd(event.target.value)}
        />
        {!patientId && (
          <Select
            label="Paciente"
            value={personFilter}
            onChange={(event) =>
              setParams((previous) => {
                event.target.value
                  ? previous.set("paciente", event.target.value)
                  : previous.delete("paciente");
                return previous;
              })
            }
          >
            <option value="">Todos os pacientes</option>
            {data.patients.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) =>
            setParams((previous) => {
              event.target.value
                ? previous.set("status", event.target.value)
                : previous.delete("status");
              return previous;
            })
          }
        >
          <option value="">Todos os status</option>
          {["Pago", "Em dia", "Vencendo", "Vencido"].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setPlan(true)}>
          Criar plano de pagamento
        </Button>
      </div>
      <div className="mb-6 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-white xl:grid-cols-4">
        <Metric
          label="Previsto no período"
          value={currency(sum(inPeriod))}
          detail="Total das parcelas no intervalo"
        />
        <Metric
          label="Recebido"
          value={currency(sum(inPeriod.filter((charge) => charge.paid)))}
          detail="Pagamentos confirmados"
        />
        <Metric
          label="A receber"
          value={currency(sum(inPeriod.filter((charge) => !charge.paid)))}
          detail="Parcelas em aberto no período"
        />
        <Metric
          label="Vencido"
          value={currency(sum(inPeriod.filter((charge) => !charge.paid && charge.due < DEMO_DATE)))}
          detail="Requer contato com o paciente"
          attention
        />
      </div>
      <Tabs
        tabs={["Todos", "A receber", "Vencidos", "Recebidos"]}
        selected={tab}
        onChange={setTab}
      />
      <Panel>
        {filtered.length ? (
          <Table
            headers={[
              "Paciente / tratamento",
              "Descrição",
              "Valor",
              "Vencimento",
              "Pagamento",
              "Status",
              "Cobrança",
              "",
            ]}
          >
            {filtered.map((charge) => (
              <tr key={charge.id}>
                <td>
                  <button
                    className="text-left"
                    onClick={() =>
                      navigate(`/app/pacientes/${charge.patientId}?aba=Financeiro`, {
                        state: {
                          returnTo: "/app/financeiro" + location.search,
                        },
                      })
                    }
                  >
                    <strong className="font-medium hover:text-primary">
                      {patient(charge.patientId).name}
                    </strong>
                    <small className="mt-1 block text-xs text-muted-foreground">
                      {data.treatments.find((item) => item.id === charge.treatmentId)?.name}
                    </small>
                  </button>
                </td>
                <td>{charge.title}</td>
                <td className="font-medium tabular-nums">{currency(charge.value)}</td>
                <td>{shortDate(charge.due)}</td>
                <td className="text-xs text-muted-foreground">
                  {charge.method || "Não recebido"}
                  <small className="mt-1 block">{charge.paid ? shortDate(charge.paid) : "—"}</small>
                </td>
                <td>
                  <Badge>{chargeStatus(charge)}</Badge>
                </td>
                <td>
                  <button onClick={() => setSelected(charge.id)} className="text-xs text-primary">
                    {charge.automatic && data.automations[2] ? "WhatsApp ativo" : "Configurar"}
                  </button>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    {!charge.paid && (
                      <IconButton
                        label="Registrar pagamento"
                        onClick={() =>
                          open({
                            kind: "payment",
                            patientId: charge.patientId,
                            chargeId: charge.id,
                          })
                        }
                      >
                        <CreditCard size={17} />
                      </IconButton>
                    )}
                    <IconButton label="Detalhes da parcela" onClick={() => setSelected(charge.id)}>
                      <ChevronRight size={17} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="Nenhuma movimentação neste período"
            text="Ajuste as datas ou configure o plano financeiro do tratamento."
          />
        )}
      </Panel>
      {selectedCharge && (
        <Overlay title="Detalhes da cobrança" onClose={() => setSelected(null)} drawer>
          <h3 className="text-lg font-semibold">{patient(selectedCharge.patientId).name}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {selectedCharge.title} ·{" "}
            {data.treatments.find((item) => item.id === selectedCharge.treatmentId)?.name}
          </p>
          <p className="my-5 text-3xl font-semibold">{currency(selectedCharge.value, true)}</p>
          <Badge>{chargeStatus(selectedCharge)}</Badge>
          <p className="my-4 text-sm">Vencimento: {shortDate(selectedCharge.due)}</p>
          <div className="my-5 flex items-center justify-between rounded-lg bg-muted p-4">
            <div>
              <p className="text-sm font-medium">Cobrança automática</p>
              <p className="mt-1 text-xs text-muted-foreground">
                WhatsApp · 2 dias antes do vencimento
              </p>
            </div>
            <Toggle
              checked={selectedCharge.automatic}
              label="Ativar cobrança automática desta parcela"
              onChange={async () => {
                const automatic = !selectedCharge.automatic;
                try {
                  if (authMode === "authenticated")
                    await command("installment.reminder", {
                      installmentId: selectedCharge.id,
                      automatic,
                    });
                  else
                    update((previous) => ({
                      ...previous,
                      charges: previous.charges.map((charge) =>
                        charge.id === selectedCharge.id ? { ...charge, automatic } : charge,
                      ),
                    }));
                } catch (error) {
                  notify(
                    error instanceof Error
                      ? error.message
                      : "Não foi possível atualizar o lembrete.",
                    true,
                  );
                }
              }}
            />
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {data.automations[2]
              ? "Regra interna ativa. O envio externo só ocorrerá quando a integração oficial estiver configurada e o paciente tiver consentimento válido."
              : "Para habilitar a regra interna, acesse Configurações → Automações. O envio externo está desativado."}
          </p>
          <div className="rounded-lg border border-border p-4 text-sm leading-relaxed">
            Olá, {patient(selectedCharge.patientId).name.split(" ")[0]}! Sua parcela de{" "}
            {currency(selectedCharge.value, true)} vence em {shortDate(selectedCharge.due)}. Podemos
            ajudar com o pagamento?
          </div>
          <div className="mt-5 grid gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(null);
                open({
                  kind: "message",
                  patientId: selectedCharge.patientId,
                  text: `Olá, ${patient(selectedCharge.patientId).name.split(" ")[0]}! Sua parcela de ${currency(selectedCharge.value, true)} vence em ${shortDate(selectedCharge.due)}. Podemos ajudar com o pagamento?`,
                });
              }}
            >
              <MessageCircle size={16} />
              Preparar cobrança no WhatsApp
            </Button>
            {!selectedCharge.paid && (
              <Button
                onClick={() => {
                  setSelected(null);
                  open({
                    kind: "payment",
                    patientId: selectedCharge.patientId,
                    chargeId: selectedCharge.id,
                  });
                }}
              >
                Registrar pagamento
              </Button>
            )}
          </div>
        </Overlay>
      )}
      {plan && <PaymentPlan treatments={treatments} close={() => setPlan(false)} />}
    </>
  );
}
function PaymentPlan({ treatments, close }: { treatments: Treatment[]; close: () => void }) {
  const { update, patient, notify, record, authMode, command } = useDemo();
  const [id, setId] = useState(treatments[0]?.id || "");
  const [count, setCount] = useState(5);
  const [due, setDue] = useState(addDays(DEMO_DATE, 30));
  const treatment = treatments.find((item) => item.id === id);
  return (
    <Overlay title="Criar plano de pagamento" onClose={close}>
      {!treatment ? (
        <Empty
          title="Todos os tratamentos já possuem parcelas"
          text="Para evitar duplicidade, crie o plano após cadastrar ou converter um novo tratamento."
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (authMode === "authenticated") {
              try {
                await command("payment-plan.create", {
                  treatmentId: treatment.id,
                  count,
                  firstDueDate: due,
                });
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : "Não foi possível criar o plano.",
                  true,
                );
                return;
              }
              notify("Plano criado e conectado ao tratamento.");
              close();
              return;
            }
            const totalCents = Math.round(treatment.total * 100);
            const regular = Math.floor(totalCents / count);
            const charges = Array.from({ length: count }, (_, index) => {
              const date = new Date(`${due}T12:00:00Z`);
              const day = date.getUTCDate();
              date.setUTCDate(1);
              date.setUTCMonth(date.getUTCMonth() + index);
              const lastDay = new Date(
                Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
              ).getUTCDate();
              date.setUTCDate(Math.min(day, lastDay));
              return {
                id: uid(),
                patientId: treatment.patientId,
                treatmentId: treatment.id,
                title: `Parcela ${index + 1}/${count}`,
                value: (index === count - 1 ? totalCents - regular * (count - 1) : regular) / 100,
                due: date.toISOString().slice(0, 10),
                automatic: true,
              };
            });
            update((previous) => ({
              ...previous,
              charges: [...previous.charges, ...charges],
            }));
            record(
              treatment.patientId,
              "Plano financeiro criado",
              `${count} parcelas · ${currency(treatment.total)}`,
              "Financeiro",
            );
            notify("Plano criado e conectado ao tratamento.");
            close();
          }}
        >
          <Select label="Tratamento" value={id} onChange={(event) => setId(event.target.value)}>
            {treatments.map((item) => (
              <option key={item.id} value={item.id}>
                {patient(item.patientId).name} · {item.name}
              </option>
            ))}
          </Select>
          <p className="rounded-lg bg-secondary p-4 text-sm">
            Valor contratado: <strong>{currency(treatment.total, true)}</strong>
          </p>
          <Field
            label="Quantidade de parcelas"
            type="number"
            min="1"
            max="24"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            required
          />
          <Field
            label="Primeiro vencimento"
            type="date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Parcelas mensais. A última parcela ajusta o arredondamento para preservar o valor
            contratado.
          </p>
          <Button
            type="submit"
            disabled={treatment.total <= 0 || count < 1 || count > 24}
            className="w-full"
          >
            Criar {count} parcelas
          </Button>
          {treatment.total <= 0 && (
            <p className="text-xs text-red-700">
              Defina um valor contratado antes de criar as parcelas.
            </p>
          )}
        </form>
      )}
    </Overlay>
  );
}
export function AccessDenied() {
  const navigate = useNavigate();
  return (
    <Empty
      title="Acesso restrito ao seu perfil"
      text="Informações financeiras estão disponíveis apenas aos perfis autorizados pela clínica."
      action={<Button onClick={() => navigate("/app")}>Voltar ao Dashboard</Button>}
    />
  );
}
