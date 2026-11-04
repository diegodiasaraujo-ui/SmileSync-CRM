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
} from "lucide-react";
import { useDemo } from "./store";
import { DEMO_DATE, activeAppointment, currency, longDate, shortDate } from "./data";
import { Header, Button, Metric, Panel, Badge, Avatar, TextLink, IconButton, Empty } from "./ui";
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
  const { data, open, canFinance, patient } = useDemo();
  const navigate = useNavigate();
  const accountFirstName = greetingName(data.account.name);
  const today = data.appointments
    .filter((appointment) => appointment.date === DEMO_DATE && appointment.status !== "Cancelado")
    .sort((first, second) => first.time.localeCompare(second.time));
  const waiting = today.filter((appointment) => appointment.status === "Aguardando confirmação");
  const upcoming = today.filter(activeAppointment);
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
      <Header
        title={accountFirstName ? `Bom dia, ${accountFirstName}.` : "Bom dia!"}
        subtitle={`${waiting.length} consultas aguardam confirmação. ${
          noReturn.length
            ? `${noReturn.length} tratamentos precisam de um retorno ativo.`
            : `${priorities.length} tratamentos têm alta prioridade clínica.`
        }`}
      >
        <span className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-muted-foreground">
          <CalendarDays size={15} />
          {longDate(DEMO_DATE)}
        </span>
      </Header>
      <div className="mb-6 flex flex-wrap items-center gap-2">
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
            <Button variant="ghost" onClick={() => open({ kind: "payment" })}>
              <Wallet size={16} />
              Registrar pagamento
            </Button>
          </>
        )}
      </div>
      <section
        aria-label="Indicadores de hoje"
        className="mb-6 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-white lg:grid-cols-4"
      >
        <Metric
          label="Consultas hoje"
          value={today.length}
          detail={`${today.filter((appointment) => appointment.status === "Concluído").length} atendimento concluído`}
          onClick={() => navigate("/app/agenda")}
        />
        <Metric
          label="Aguardando confirmação"
          value={waiting.length}
          detail="Uma mensagem pode resolver"
          attention={!!waiting.length}
          onClick={() => navigate("/app/agenda?status=Aguardando+confirmação")}
        />
        <Metric
          label="Retornos pendentes"
          value={noReturn.length}
          detail="Sem próxima consulta ativa"
          onClick={() => navigate("/app/tratamentos?filtro=sem-retorno")}
        />
        {canFinance ? (
          <Metric
            label="A receber"
            value={currency(receivable)}
            detail={`${overdue.length} parcelas vencidas`}
            onClick={() => navigate("/app/financeiro")}
          />
        ) : (
          <Metric
            label="Tratamentos ativos"
            value={
              data.treatments.filter(
                (treatment) => !["Concluído", "Cancelado"].includes(treatment.status),
              ).length
            }
            detail="Acompanhamento clínico"
            onClick={() => navigate("/app/tratamentos")}
          />
        )}
      </section>
      <div className="mb-6 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
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
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-4"
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
                      {appointment.professional.replace(" Almeida", "").replace(" Moreira", "")} ·{" "}
                      {appointment.room}
                    </span>
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge>{appointment.status}</Badge>
                    <IconButton
                      label={`WhatsApp de ${patient(appointment.patientId).name}`}
                      className="size-8"
                      onClick={() =>
                        open({
                          kind: "message",
                          patientId: appointment.patientId,
                        })
                      }
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
            {today.filter((appointment) => appointment.status === "Confirmado").length} confirmados
            · {waiting.length} aguardando confirmação
          </div>
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel title="Atenção hoje" subtitle="Pendências que merecem uma ação">
            {clinicalItems
              .filter((item) => item.count > 0)
              .map((item) => (
                <div key={item.text} className="flex gap-3 border-t border-border px-5 py-4">
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
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {item.action}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
          </Panel>
          <div className="rounded-xl bg-secondary px-5 py-4">
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
                <Button
                  variant="secondary"
                  onClick={() => open({ kind: "message", patientId: person.id })}
                >
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
