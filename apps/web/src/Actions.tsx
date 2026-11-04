import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { CalendarPlus, FilePlus2, Check, ArrowRight, MessageCircle, Plus } from "lucide-react";
import { useDemo, type Action } from "./store";
import {
  DEMO_DATE,
  addDays,
  uid,
  professionalNames,
  currency,
  type Patient,
  type Appointment,
} from "./data";
import { Overlay, Field, Select, Button, inputClass, Badge } from "./ui";

const titles = {
  patient: "Novo paciente",
  appointment: "Novo agendamento",
  quote: "Novo orçamento",
  payment: "Registrar pagamento",
  message: "WhatsApp do paciente",
  note: "Registrar interação",
  treatment: "Adicionar tratamento",
};
export function ActionLayer() {
  const { action } = useDemo();
  return action ? <ActionForm key={JSON.stringify(action)} action={action} /> : null;
}
function ActionForm({ action }: { action: Action }) {
  const { data, update, close, notify, canFinance, record, open, authMode, command } = useDemo();
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState(action.patientId || data.patients[0]?.id || "");
  const currentPatient = data.patients.find((patient) => patient.id === patientId);
  const currentAppointment = data.appointments.find(
    (appointment) => appointment.id === action.appointmentId,
  );
  const availableCharges = data.charges.filter(
    (charge) => charge.patientId === patientId && !charge.paid,
  );
  const availableProfessionals = professionalNames(data);
  const [chargeId, setChargeId] = useState(action.chargeId || availableCharges[0]?.id || "");
  const [created, setCreated] = useState<Patient | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(
    action.text ||
      `Olá, ${currentPatient?.name.split(" ")[0] || ""}! Tudo bem? Podemos confirmar sua próxima consulta?`,
  );
  const financialAction = action.kind === "payment" || action.kind === "quote";
  const persist = async <T,>(type: string, payload: Record<string, unknown>) => {
    try {
      return await command<T>(type, payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível concluir a operação.",
      );
      return null;
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (financialAction && !canFinance) {
      setError("Seu perfil não possui permissão para esta ação financeira.");
      return;
    }
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || "").trim();
    if (action.kind === "patient") {
      const phoneDigits = value("phone").replace(/\D/g, "");
      if (phoneDigits.length < 10 || phoneDigits.length > 13) {
        setError("Informe um telefone válido com DDD.");
        return;
      }
      if (!value("name").includes(" ")) {
        setError("Informe o nome e sobrenome do paciente.");
        return;
      }
      let patient: Patient = {
        id: uid(),
        name: value("name"),
        phone: value("phone"),
        email: value("email"),
        city: value("city"),
        since: DEMO_DATE,
        tags: ["Novo paciente"],
        notes: value("notes"),
      };
      if (authMode === "authenticated") {
        const saved = await persist<Patient>("patient.create", {
          name: patient.name,
          phone: patient.phone,
          email: patient.email,
          city: patient.city,
          notes: patient.notes,
        });
        if (!saved) return;
        patient = saved;
      } else
        update((previous) => ({
          ...previous,
          patients: [...previous.patients, patient],
          interactions: [
            {
              id: uid(),
              patientId: patient.id,
              date: new Date().toISOString(),
              title: "Paciente cadastrado",
              text: "Cadastro realizado pela equipe.",
              kind: "Operação",
            },
            ...previous.interactions,
          ],
        }));
      setCreated(patient);
      notify("Paciente cadastrado.");
      return;
    }
    if (!currentPatient) {
      setError("Selecione um paciente.");
      return;
    }
    if (action.kind === "appointment") {
      const duration = Number(value("duration"));
      const startMinutes = (time: string) =>
        Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]);
      const start = startMinutes(value("time"));
      if (start < 8 * 60 || start + duration > 18 * 60) {
        setError("Escolha um horário dentro do funcionamento da clínica: 08:00 às 18:00.");
        return;
      }
      if (
        data.appointments.some(
          (appointment) =>
            appointment.id !== currentAppointment?.id &&
            appointment.date === value("date") &&
            appointment.status !== "Cancelado" &&
            (appointment.professional === value("professional") ||
              appointment.room === value("room")) &&
            start < startMinutes(appointment.time) + appointment.duration &&
            start + duration > startMinutes(appointment.time),
        )
      ) {
        setError(
          "Este horário conflita com outro atendimento do profissional ou da sala. Escolha outro horário.",
        );
        return;
      }
      const appointment: Appointment = {
        id: currentAppointment?.id || uid(),
        patientId,
        treatmentId: value("treatmentId") || undefined,
        date: value("date"),
        time: value("time"),
        procedure: value("procedure"),
        duration,
        professional: value("professional"),
        room: value("room"),
        status: currentAppointment ? "Remarcado" : "Aguardando confirmação",
      };
      if (authMode === "authenticated") {
        const saved = await persist<Appointment>("appointment.save", {
          id: currentAppointment?.id,
          patientId,
          treatmentId: appointment.treatmentId,
          date: appointment.date,
          time: appointment.time,
          procedure: appointment.procedure,
          duration: appointment.duration,
          professional: appointment.professional,
          room: appointment.room,
        });
        if (!saved) return;
      } else {
        update((previous) => ({
          ...previous,
          appointments: currentAppointment
            ? previous.appointments.map((item) => (item.id === appointment.id ? appointment : item))
            : [...previous.appointments, appointment],
          treatments: previous.treatments.map((treatment) =>
            treatment.id === appointment.treatmentId
              ? {
                  ...treatment,
                  steps: treatment.steps.map((step, index) =>
                    index === treatment.steps.findIndex((entry) => !entry.done)
                      ? { ...step, date: appointment.date }
                      : step,
                  ),
                }
              : treatment,
          ),
        }));
        record(
          patientId,
          currentAppointment ? "Consulta remarcada" : "Consulta agendada",
          `${appointment.procedure} · ${appointment.date} · ${appointment.time}`,
          "Agenda",
        );
      }
      notify(currentAppointment ? "Consulta remarcada." : "Consulta agendada.");
    }
    if (action.kind === "quote") {
      const amount = Number(value("value")),
        discount = Number(value("discount"));
      if (discount >= amount) {
        setError("O desconto deve ser menor que o valor do orçamento.");
        return;
      }
      if (authMode === "authenticated") {
        const saved = await persist("quote.create", {
          patientId,
          procedure: value("procedure"),
          value: amount,
          discount,
          validity: value("validity"),
        });
        if (!saved) return;
      } else {
        update((previous) => ({
          ...previous,
          quotes: [
            ...previous.quotes,
            {
              id: uid(),
              patientId,
              procedure: value("procedure"),
              value: amount,
              discount,
              validity: value("validity"),
              status: "Rascunho",
            },
          ],
        }));
        record(
          patientId,
          "Orçamento criado",
          `${value("procedure")} · ${currency(amount - discount)}`,
          "Orçamento",
        );
      }
      notify("Orçamento salvo como rascunho.");
    }
    if (action.kind === "payment") {
      const charge = data.charges.find(
        (item) => item.id === chargeId && item.patientId === patientId && !item.paid,
      );
      if (!charge) {
        setError("Selecione uma parcela em aberto.");
        return;
      }
      if (authMode === "authenticated") {
        const saved = await persist("payment.create", {
          installmentId: charge.id,
          paidOn: value("paid"),
          method: value("method"),
          amount: charge.value,
        });
        if (!saved) return;
      } else {
        update((previous) => ({
          ...previous,
          charges: previous.charges.map((item) =>
            item.id === charge.id
              ? { ...item, paid: value("paid"), method: value("method") }
              : item,
          ),
        }));
        record(
          patientId,
          `Pagamento de ${currency(charge.value)} registrado`,
          `${charge.title} · ${value("method")}`,
          "Financeiro",
        );
      }
      notify("Pagamento registrado. Saldo do paciente atualizado.");
    }
    if (action.kind === "note") {
      if (authMode === "authenticated") {
        const saved = await persist("interaction.create", {
          patientId,
          title: value("title"),
          text: value("notes"),
          kind: value("kind"),
        });
        if (!saved) return;
      } else record(patientId, value("title"), value("notes"), value("kind"));
      notify("Interação adicionada ao histórico.");
    }
    if (action.kind === "message") {
      if (currentPatient.phone.replace(/\D/g, "").length < 10) {
        setError("Adicione um telefone válido à ficha antes de abrir uma conversa.");
        return;
      }
      if (authMode === "authenticated") {
        const saved = await persist("message.draft", { patientId, message });
        if (!saved) return;
      } else record(patientId, "Mensagem preparada para WhatsApp", message, "WhatsApp");
      notify(
        "Rascunho salvo. O envio real permanece desativado até a integração oficial ser configurada.",
      );
    }
    if (action.kind === "treatment") {
      const steps = value("steps")
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean);
      if (!steps.length) {
        setError("Adicione ao menos uma etapa ao tratamento.");
        return;
      }
      let treatmentId: string = uid();
      if (authMode === "authenticated") {
        const saved = await persist<{ id: string }>("treatment.create", {
          patientId,
          name: value("name"),
          professional: value("professional"),
          total: canFinance ? Number(value("value")) : 0,
          steps,
        });
        if (!saved) return;
        treatmentId = saved.id;
      } else {
        update((previous) => ({
          ...previous,
          treatments: [
            ...previous.treatments,
            {
              id: treatmentId,
              patientId,
              name: value("name"),
              professional: value("professional"),
              total: canFinance ? Number(value("value")) : 0,
              status: "Planejamento",
              priority: "Média",
              steps: steps.map((name) => ({ name, date: "", done: false })),
            },
          ],
        }));
        record(patientId, "Tratamento adicionado", value("name"), "Clínico");
      }
      notify("Tratamento adicionado. Configure as etapas e o plano financeiro.");
      close();
      navigate(`/app/tratamentos/${treatmentId}`);
      return;
    }
    close();
  };
  return (
    <Overlay
      title={
        created ? "Paciente criado" : currentAppointment ? "Remarcar consulta" : titles[action.kind]
      }
      onClose={close}
      drawer
    >
      {created ? (
        <div className="space-y-6">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
            <Check size={24} />
          </span>
          <h3 className="text-xl font-semibold">{created.name}</h3>
          <p className="text-sm text-muted-foreground">
            O cadastro está pronto. O que deseja fazer agora?
          </p>
          <div className="grid gap-3">
            {(
              [
                ["appointment", "Agendar consulta", CalendarPlus],
                ["quote", "Criar orçamento", FilePlus2],
                ["treatment", "Adicionar tratamento", Plus],
              ] as const
            )
              .filter(([kind]) => kind !== "quote" || canFinance)
              .map(([kind, label, Icon]) => (
                <Button
                  key={kind}
                  variant="secondary"
                  className="justify-between"
                  onClick={() => open({ kind, patientId: created.id })}
                >
                  <span className="flex items-center gap-3">
                    <Icon size={18} />
                    {label}
                  </span>
                  <ArrowRight size={16} />
                </Button>
              ))}
          </div>
          <Button
            className="w-full"
            onClick={() => {
              close();
              navigate(`/app/pacientes/${created.id}`);
            }}
          >
            Abrir ficha do paciente
          </Button>
          <Button variant="ghost" className="w-full" onClick={close}>
            Concluir
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {action.kind === "message"
              ? "Prepare um rascunho com o contexto mínimo necessário. Nenhuma mensagem será enviada enquanto a integração oficial estiver desativada."
              : "Este registro ficará conectado à ficha do paciente e ao histórico da clínica."}
          </p>
          {action.kind !== "patient" && (
            <Select
              label="Paciente"
              value={patientId}
              onChange={(event) => {
                setPatientId(event.target.value);
                setChargeId(
                  data.charges.find(
                    (charge) => charge.patientId === event.target.value && !charge.paid,
                  )?.id || "",
                );
              }}
            >
              {data.patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.name}
                </option>
              ))}
            </Select>
          )}
          {action.kind === "patient" && (
            <>
              <Field
                label="Nome completo"
                name="name"
                required
                autoFocus
                placeholder="Nome e sobrenome"
              />
              <Field
                label="WhatsApp / telefone"
                name="phone"
                type="tel"
                required
                placeholder="(34) 99999-9999"
                pattern="[\+\(\)\d\s\-]{10,20}"
              />
              <Field label="E-mail" name="email" type="email" placeholder="paciente@email.com" />
              <Field label="Cidade" name="city" defaultValue="Patos de Minas" required />
              <Field
                label="Observações de contato"
                name="notes"
                placeholder="Preferências do paciente (opcional)"
              />
            </>
          )}
          {action.kind === "appointment" && (
            <>
              <Field
                label="Procedimento"
                name="procedure"
                required
                defaultValue={currentAppointment?.procedure || "Avaliação inicial"}
              />
              <Select
                label="Tratamento relacionado"
                name="treatmentId"
                defaultValue={currentAppointment?.treatmentId || ""}
              >
                <option value="">Sem tratamento relacionado</option>
                {data.treatments
                  .filter((treatment) => treatment.patientId === patientId)
                  .map((treatment) => (
                    <option key={treatment.id} value={treatment.id}>
                      {treatment.name}
                    </option>
                  ))}
              </Select>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Data"
                  type="date"
                  name="date"
                  defaultValue={action.date || currentAppointment?.date || DEMO_DATE}
                  required
                />
                <Field
                  label="Horário"
                  type="time"
                  name="time"
                  defaultValue={action.time || currentAppointment?.time || "08:00"}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Duração"
                  name="duration"
                  defaultValue={currentAppointment?.duration || 30}
                >
                  {[15, 30, 45, 60, 90, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                </Select>
                <Select
                  label="Sala"
                  name="room"
                  defaultValue={currentAppointment?.room || "Sala 01"}
                >
                  {["Sala 01", "Sala 02", "Sala 03"].map((room) => (
                    <option key={room}>{room}</option>
                  ))}
                </Select>
              </div>
              <Select
                label="Profissional"
                name="professional"
                defaultValue={currentAppointment?.professional || availableProfessionals[0] || ""}
              >
                {availableProfessionals.map((professional) => (
                  <option key={professional}>{professional}</option>
                ))}
              </Select>
            </>
          )}
          {action.kind === "quote" && (
            <>
              <Field
                label="Procedimento / plano de tratamento"
                name="procedure"
                required
                placeholder="Ex.: Implante dentário"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Valor (R$)"
                  name="value"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
                <Field
                  label="Desconto (R$)"
                  name="discount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
              </div>
              <Field
                label="Válido até"
                name="validity"
                type="date"
                min={DEMO_DATE}
                defaultValue={addDays(DEMO_DATE, 14)}
                required
              />
            </>
          )}
          {action.kind === "payment" && (
            <>
              <Select
                label="Parcela em aberto"
                value={chargeId}
                onChange={(event) => setChargeId(event.target.value)}
                required
              >
                <option value="">Selecione uma parcela</option>
                {availableCharges.map((charge) => (
                  <option key={charge.id} value={charge.id}>
                    {charge.title} · {currency(charge.value)}
                  </option>
                ))}
              </Select>
              {!availableCharges.length && (
                <p className="rounded-lg bg-muted p-3 text-sm">
                  Este paciente não possui parcelas em aberto.
                </p>
              )}
              <Select label="Forma de pagamento" name="method">
                <option>Pix</option>
                <option>Cartão</option>
                <option>Dinheiro</option>
                <option>Transferência</option>
              </Select>
              <Field
                label="Data do pagamento"
                name="paid"
                type="date"
                max={DEMO_DATE}
                defaultValue={DEMO_DATE}
                required
              />
            </>
          )}
          {action.kind === "message" && (
            <>
              <div className="flex flex-wrap gap-2">
                {[
                  "Confirmar consulta",
                  "Enviar orçamento",
                  "Lembrar pagamento",
                  "Solicitar retorno",
                  "Pós-procedimento",
                ]
                  .filter(
                    (template) =>
                      canFinance || !["Enviar orçamento", "Lembrar pagamento"].includes(template),
                  )
                  .map((template) => (
                    <Button
                      key={template}
                      variant="secondary"
                      className="min-h-8 text-xs"
                      onClick={() =>
                        setMessage(
                          template === "Lembrar pagamento"
                            ? `Olá, ${currentPatient?.name.split(" ")[0]}! Sua próxima parcela está disponível na clínica. Podemos ajudar com o pagamento?`
                            : template === "Solicitar retorno"
                              ? `Olá, ${currentPatient?.name.split(" ")[0]}! Vamos agendar seu retorno na ${data.clinic}?`
                              : template === "Pós-procedimento"
                                ? `Olá, ${currentPatient?.name.split(" ")[0]}! Como você está após o procedimento? Se precisar, estamos à disposição.`
                                : template === "Enviar orçamento"
                                  ? `Olá, ${currentPatient?.name.split(" ")[0]}! Seu orçamento está pronto. Podemos conversar sobre o plano de tratamento?`
                                  : `Olá, ${currentPatient?.name.split(" ")[0]}! Podemos confirmar sua consulta na ${data.clinic}?`,
                        )
                      }
                    >
                      {template}
                    </Button>
                  ))}
              </div>
              <label className="grid gap-2 text-sm font-medium">
                Mensagem
                <textarea
                  className={`${inputClass} min-h-36`}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  required
                />
              </label>
              <Badge>Envio real desativado</Badge>
            </>
          )}
          {action.kind === "note" && (
            <>
              <Field label="Título da interação" name="title" required />
              <Select label="Tipo de registro" name="kind">
                <option>Operação</option>
                <option>Clínico</option>
                <option>Contato</option>
                <option>Atestado</option>
                <option>Afastamento</option>
                <option>Prescrição</option>
                <option>Medicação</option>
              </Select>
              <label className="grid gap-2 text-sm font-medium">
                Descrição
                <textarea className={`${inputClass} min-h-32`} name="notes" required />
              </label>
            </>
          )}
          {action.kind === "treatment" && (
            <>
              <Field label="Tratamento" name="name" required />
              <Select label="Profissional" name="professional">
                {availableProfessionals.map((professional) => (
                  <option key={professional}>{professional}</option>
                ))}
              </Select>
              {canFinance && (
                <Field
                  label="Valor contratado (R$)"
                  name="value"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  required
                />
              )}
              <label className="grid gap-2 text-sm font-medium">
                Etapas (uma por linha)
                <textarea
                  className={`${inputClass} min-h-36`}
                  name="steps"
                  defaultValue={"Avaliação\nPlanejamento\nProcedimento\nRetorno\nFinalização"}
                  required
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-5">
            <Button variant="secondary" onClick={close}>
              Voltar
            </Button>
            <Button
              type="submit"
              disabled={
                (action.kind === "payment" && !availableCharges.length) ||
                (financialAction && !canFinance)
              }
            >
              {action.kind === "message" ? (
                <>
                  <MessageCircle size={16} />
                  Salvar rascunho
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </form>
      )}
    </Overlay>
  );
}
