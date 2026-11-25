import { useNavigate } from "react-router";
import {
  CalendarPlus,
  UserRoundPlus,
  FilePlus2,
  Wallet,
  ArrowRight,
  CalendarDays,
  MessageCircle,
  CheckCircle2,
  Clock3,
  CircleAlert,
  Activity,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import { useDemo } from "./store";
import { DEMO_DATE, activeAppointment, currency, longDate, shortDate } from "./data";
import { Button, Panel, Badge, Avatar, TextLink, IconButton, Empty } from "./ui";
import { TREATMENTS_MODULE_LABEL } from "./moduleLabels";

const professionalTitle = /^(?:dr|dra|doutor|doutora)\.?$/iu;

function greetingName(fullName: string) {
  return fullName
    .trim()
    .split(/\s+/u)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .find((part) => part.length > 0 && !professionalTitle.test(part));
}

export function Dashboard() {
  const { data, open, canFinance, patient, permissions } = useDemo();
  const navigate = useNavigate();
  const accountFirstName = greetingName(data.account.name);
  const today = data.appointments
    .filter((appointment) => appointment.date === DEMO_DATE && appointment.status !== "Cancelado")
    .sort((first, second) => first.time.localeCompare(second.time));
  const waiting = today.filter((appointment) => appointment.status === "Aguardando confirmação");
  const upcoming = today.filter(activeAppointment);
  const confirmed = today.filter((appointment) => appointment.status === "Confirmado").length;
  const completed = today.filter((appointment) => appointment.status === "Concluído").length;
  const noReturn = data.treatments.filter(
    (treatment) =>
      !["Concluído", "Cancelado"].includes(treatment.status) &&
      !data.appointments.some(
        (appointment) =>
          appointment.treatmentId === treatment.id &&
          appointment.date >= DEMO_DATE &&
          activeAppointment(appointment),
      ),
  );
  const overdue = data.charges.filter((charge) => !charge.paid && charge.due < DEMO_DATE);
  const receivable = data.charges
    .filter((charge) => !charge.paid)
    .reduce((sum, charge) => sum + charge.value, 0);
  const priorities = data.treatments.filter(
    (treatment) =>
      treatment.priority === "Alta" && !["Concluído", "Cancelado"].includes(treatment.status),
  );
  const contact = (patientId: string) => {
    if (permissions.includes("whatsapp.inbox.read")) {
      navigate(`/app/whatsapp?paciente=${encodeURIComponent(patientId)}`);
      return;
    }
    open({ kind: "message", patientId });
  };
  const metrics = [
    {
      label: "Consultas hoje",
      value: today.length,
      detail: `${completed} ${completed === 1 ? "atendimento concluído" : "atendimentos concluídos"}`,
      Icon: CalendarDays,
      iconClass: "bg-secondary text-primary",
      path: "/app/agenda",
    },
    {
      label: "Aguardando confirmação",
      value: waiting.length,
      detail: "Consultas deste dia",
      Icon: Clock3,
      iconClass: "bg-blue-50 text-primary",
      path: "/app/agenda?status=Aguardando+confirmação",
    },
    {
      label: "Retornos pendentes",
      value: noReturn.length,
      detail: "Sem próxima consulta ativa",
      Icon: RotateCw,
      iconClass: "bg-indigo-50 text-indigo-700",
      path: "/app/tratamentos?filtro=sem-retorno",
    },
    canFinance
      ? {
          label: "A receber",
          value: currency(receivable),
          detail: `${overdue.length} ${overdue.length === 1 ? "parcela vencida" : "parcelas vencidas"}`,
          Icon: Wallet,
          iconClass: "bg-emerald-100 text-emerald-800",
          path: "/app/financeiro",
          finance: true,
        }
      : {
          label: "Tratamentos ativos",
          value: data.treatments.filter((item) => !["Concluído", "Cancelado"].includes(item.status))
            .length,
          detail: "Em acompanhamento",
          Icon: Activity,
          iconClass: "bg-secondary text-primary",
          path: "/app/tratamentos",
        },
  ];
  const clinicalItems = [
    {
      count: waiting.length,
      text: "consultas aguardam confirmação",
      action: "Confirmar agenda",
      path: "/app/agenda?status=Aguardando+confirmação",
      Icon: CalendarDays,
      color: "text-amber-700 bg-amber-50",
    },
    {
      count: noReturn.length,
      text: "tratamentos sem retorno ativo",
      action: "Organizar retornos",
      path: "/app/tratamentos?filtro=sem-retorno",
      Icon: Activity,
      color: "text-primary bg-secondary",
    },
    ...(canFinance
      ? [
          {
            count: overdue.length,
            text: "pagamentos estão vencidos",
            action: "Ver cobranças",
            path: "/app/financeiro?status=Vencido",
            Icon: Wallet,
            color: "text-red-700 bg-red-50",
          },
        ]
      : []),
  ];
  return (
    <>
      <section className="mb-5" aria-label="Visão geral da clínica">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-[-0.04em] sm:text-[35px]">
              {accountFirstName ? `Olá, ${accountFirstName}.` : "Olá."}
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {waiting.length || noReturn.length ? (
                <>
                  {waiting.length}{" "}
                  {waiting.length === 1 ? "consulta aguarda" : "consultas aguardam"} confirmação.{" "}
                  {noReturn.length}{" "}
                  {noReturn.length === 1 ? "tratamento precisa" : "tratamentos precisam"} de
                  retorno.
                </>
              ) : (
                "Sua agenda e os indicadores da clínica em um só lugar."
              )}
            </p>
          </div>
          <span className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-[12px] font-medium text-foreground">
            <CalendarDays size={15} className="text-primary" />
            {longDate(DEMO_DATE)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button onClick={() => open({ kind: "patient" })}>
            <UserRoundPlus size={16} />
            Novo paciente
          </Button>
          <Button variant="secondary" onClick={() => open({ kind: "appointment" })}>
            <CalendarPlus size={16} />
            Novo agendamento
          </Button>
          {canFinance && (
            <>
              <Button variant="secondary" onClick={() => open({ kind: "quote" })}>
                <FilePlus2 size={16} />
                Novo orçamento
              </Button>
              <Button variant="secondary" onClick={() => open({ kind: "payment" })}>
                <Wallet size={16} />
                Registrar pagamento
              </Button>
            </>
          )}
        </div>
      </section>
      <section
        aria-label="Indicadores de hoje"
        className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"
      >
        {metrics.map(({ label, value, detail, Icon, iconClass, path, finance }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(path)}
            className={`group relative flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-white px-3 py-3.5 text-left shadow-panel transition-colors hover:border-primary/40 sm:flex-row sm:items-start sm:gap-3 sm:px-4 ${finance ? "dashboard-metric--finance" : ""}`}
          >
            <span className={`grid size-10 shrink-0 place-items-center rounded-full ${iconClass}`}>
              <Icon size={19} strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block pr-3 text-[11px] font-semibold leading-snug sm:text-[12px]">
                {label}
              </span>
              <strong className="mt-0.5 block font-display text-[clamp(1.22rem,2vw,1.7rem)] font-extrabold leading-tight tracking-[-0.04em] tabular-nums">
                {value}
              </strong>
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {detail}
              </span>
            </span>
            <ArrowRight
              size={14}
              className="absolute right-2.5 top-3.5 -rotate-45 text-primary transition-transform group-hover:translate-x-0.5 sm:right-3"
              aria-hidden="true"
            />
          </button>
        ))}
      </section>
      <div className="mb-6 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel
          title="Próximos agendamentos"
          subtitle="Agenda do dia · horários e contexto em um só lugar"
          action={<TextLink onClick={() => navigate("/app/agenda")}>Abrir agenda</TextLink>}
        >
          <div>
            {upcoming.length ? (
              upcoming.map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2.5 transition-colors hover:bg-muted/40 sm:gap-x-4 sm:px-5"
                >
                  <div className="w-12 text-sm font-semibold tabular-nums">
                    {appointment.time}
                    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                      {appointment.duration} min
                    </span>
                  </div>
                  <Avatar name={patient(appointment.patientId).name} />
                  <button
                    className="min-w-[120px] flex-1 text-left"
                    onClick={() => navigate(`/app/pacientes/${appointment.patientId}`)}
                  >
                    <span className="block text-[13px] font-medium hover:text-primary">
                      {patient(appointment.patientId).name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {appointment.procedure}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {appointment.professional} · {appointment.room}
                    </span>
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge>{appointment.status}</Badge>
                    <IconButton
                      label={`WhatsApp de ${patient(appointment.patientId).name}`}
                      className="size-8"
                      onClick={() => contact(appointment.patientId)}
                    >
                      <MessageCircle size={17} />
                    </IconButton>
                    <IconButton
                      label="Detalhes do agendamento"
                      className="size-8"
                      onClick={() => navigate(`/app/agenda?consulta=${appointment.id}`)}
                    >
                      <ChevronRight size={17} />
                    </IconButton>
                  </div>
                </div>
              ))
            ) : (
              <Empty
                title="Agenda livre hoje"
                action={
                  <Button onClick={() => open({ kind: "appointment" })}>Novo agendamento</Button>
                }
              />
            )}
          </div>
          <div className="flex items-center gap-2 bg-muted/50 px-5 py-3 text-xs text-muted-foreground">
            <CheckCircle2 size={14} className="text-primary" />
            {confirmed} confirmados · {waiting.length} aguardando confirmação
          </div>
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel title="Atenção hoje" subtitle="Pendências que merecem uma ação">
            {clinicalItems.every((item) => !item.count) && (
              <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
                Sem pendências para hoje.
              </p>
            )}
            {clinicalItems
              .filter((item) => item.count > 0)
              .map((item) => (
                <div key={item.text} className="flex gap-3 border-t border-border px-5 py-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.color}`}
                  >
                    <item.Icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed">
                      <strong className="font-semibold">{item.count}</strong> {item.text}
                    </p>
                    <button
                      onClick={() => navigate(item.path)}
                      className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                    >
                      {item.action}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
          </Panel>
          <div className="rounded-xl border border-border bg-white px-5 py-3.5 shadow-panel">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
              <Clock3 size={15} />
              Ritmo da clínica
            </div>
            <p className="text-[13px] leading-relaxed">
              {data.patients.length} pacientes cadastrados e{" "}
              {data.treatments.filter((treatment) => treatment.status !== "Concluído").length}{" "}
              tratamentos em acompanhamento.
            </p>
            <button
              onClick={() => navigate("/app/tratamentos")}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              Abrir {TREATMENTS_MODULE_LABEL} →
            </button>
          </div>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Ações prioritárias</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Contexto clínico antes da próxima ação.
          </p>
        </div>
        <TextLink onClick={() => navigate("/app/tratamentos")}>
          Ver {TREATMENTS_MODULE_LABEL}
        </TextLink>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {priorities.map((treatment) => {
          const person = patient(treatment.patientId);
          const next = treatment.steps.find((step) => !step.done);
          const last = data.interactions
            .filter((interaction) => interaction.patientId === person.id)
            .sort((first, second) => second.date.localeCompare(first.date))[0];
          return (
            <section key={treatment.id} className="rounded-xl border border-border bg-white p-5">
              <div className="flex items-center gap-3">
                <Avatar name={person.name} />
                <div className="flex-1">
                  <button
                    onClick={() => navigate(`/app/pacientes/${person.id}`)}
                    className="text-sm font-medium hover:text-primary"
                  >
                    {person.name}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">{treatment.name}</p>
                </div>
                <Badge>{treatment.priority} prioridade</Badge>
              </div>
              <p className="mt-4 flex items-center gap-2 text-[13px] font-medium">
                <CircleAlert size={15} className="text-amber-700" />
                {next?.name || "Revisar conclusão"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {next?.date
                  ? `Etapa prevista para ${shortDate(next.date)}. Confirme a presença e registre a evolução após o atendimento.`
                  : "Próxima etapa sem data definida. Combine a continuidade do tratamento com o paciente."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Última interação: {last ? shortDate(last.date) : "ainda não registrada"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => contact(person.id)}>
                  <MessageCircle size={15} />
                  WhatsApp
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => open({ kind: "appointment", patientId: person.id })}
                >
                  <CalendarPlus size={15} />
                  Agendar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate(`/app/pacientes/${person.id}`, {
                      state: { returnTo: "/app" },
                    })
                  }
                >
                  Abrir paciente
                  <ArrowRight size={14} />
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
