export const CLINIC_TIMEZONE = "America/Sao_Paulo";
export const DEMO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
export const professionals = ["Dr. Sidney Almeida", "Dra. Beatriz Moreira"];
export type Role = "Administrador" | "Dentista" | "Secretária" | "Recepção" | "Financeiro";
export type Patient = {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  since: string;
  tags: string[];
  notes: string;
};
export type Step = {
  name: string;
  date: string;
  done: boolean;
};
export type Treatment = {
  id: string;
  patientId: string;
  name: string;
  professional: string;
  total: number;
  status: string;
  priority: string;
  steps: Step[];
};
export type Appointment = {
  id: string;
  patientId: string;
  treatmentId?: string;
  procedure: string;
  date: string;
  time: string;
  duration: number;
  professional: string;
  room: string;
  status: string;
};
export type Quote = {
  id: string;
  patientId: string;
  procedure: string;
  value: number;
  discount: number;
  validity: string;
  status: string;
  sent?: string;
  approved?: string;
  treatmentId?: string;
};
export type Charge = {
  id: string;
  patientId: string;
  treatmentId: string;
  title: string;
  value: number;
  due: string;
  paid?: string;
  method?: string;
  automatic: boolean;
};
export type Interaction = {
  id: string;
  patientId: string;
  date: string;
  title: string;
  text: string;
  kind: string;
};
export type DemoData = {
  patients: Patient[];
  treatments: Treatment[];
  appointments: Appointment[];
  quotes: Quote[];
  charges: Charge[];
  interactions: Interaction[];
  automations: boolean[];
  clinic: string;
  clinicPhone: string;
  clinicCity: string;
  account: {
    name: string;
    email: string;
  };
  team: {
    id: string;
    name: string;
    email: string;
    role: Role;
    status: string;
  }[];
  preferences: {
    compact: boolean;
    reminders: boolean;
  };
};

export function professionalNames(data: Pick<DemoData, "team" | "account">): string[] {
  const names = data.team
    .filter(
      (member) =>
        member.status !== "Convite pendente" && ["Administrador", "Dentista"].includes(member.role),
    )
    .map((member) => member.name.trim())
    .filter(Boolean);

  if (!names.length && data.account.name.trim()) names.push(data.account.name.trim());
  return [...new Set(names)];
}

export const initialData: DemoData = {
  clinic: "Clínica Odontológica Sidney Almeida",
  clinicPhone: "(34) 99182-4301",
  clinicCity: "Patos de Minas - MG",
  account: {
    name: "Dr. Sidney Almeida",
    email: "sidney@clinica.com.br",
  },
  team: [
    {
      id: "s",
      name: "Dr. Sidney Almeida",
      email: "sidney@clinica.com.br",
      role: "Administrador",
      status: "Ativo",
    },
    {
      id: "b",
      name: "Dra. Beatriz Moreira",
      email: "beatriz@clinica.com.br",
      role: "Dentista",
      status: "Ativo",
    },
    {
      id: "r",
      name: "Renata Costa",
      email: "renata@clinica.com.br",
      role: "Recepção",
      status: "Ativo",
    },
    {
      id: "l",
      name: "Luana Ribeiro",
      email: "luana@clinica.com.br",
      role: "Secretária",
      status: "Convite pendente",
    },
  ],
  preferences: { compact: false, reminders: true },
  patients: [
    {
      id: "mariana-oliveira",
      name: "Mariana Oliveira",
      phone: "(34) 99182-4301",
      email: "mariana.oliveira@email.com",
      city: "Patos de Minas",
      since: "2026-03-12",
      tags: ["Implante", "Acompanhamento"],
      notes: "Preferência de contato no período da manhã.",
    },
    {
      id: "carlos-henrique",
      name: "Carlos Henrique",
      phone: "(34) 99871-2640",
      email: "carlos.henrique@email.com",
      city: "Patos de Minas",
      since: "2026-04-09",
      tags: ["Sem retorno"],
      notes: "Agendar próxima manutenção ortodôntica.",
    },
    {
      id: "fernanda-alves",
      name: "Fernanda Alves",
      phone: "(34) 99114-6228",
      email: "fernanda.alves@email.com",
      city: "Patos de Minas",
      since: "2026-06-11",
      tags: ["Estética"],
      notes: "Confirmar cor e planejamento das facetas.",
    },
    {
      id: "joao-pedro-martins",
      name: "João Pedro Martins",
      phone: "(34) 99603-5190",
      email: "joao.pedro@email.com",
      city: "Presidente Olegário",
      since: "2026-08-10",
      tags: ["Outra cidade"],
      notes: "Organizar consultas para reduzir deslocamentos.",
    },
    {
      id: "ana-beatriz-souza",
      name: "Ana Beatriz Souza",
      phone: "(34) 99921-7634",
      email: "ana.beatriz@email.com",
      city: "Presidente Olegário",
      since: "2026-09-15",
      tags: ["Nova paciente", "Outra cidade"],
      notes: "Primeira avaliação. Vem de Presidente Olegário.",
    },
  ],
  treatments: [
    {
      id: "implante-mariana",
      patientId: "mariana-oliveira",
      name: "Implante dentário",
      professional: professionals[0],
      total: 8500,
      status: "Em andamento",
      priority: "Alta",
      steps: [
        { name: "Avaliação inicial", date: "2026-09-09", done: true },
        { name: "Exames e documentação", date: "2026-09-10", done: true },
        { name: "Planejamento", date: "2026-09-11", done: true },
        { name: "Procedimento de implante", date: "2026-09-12", done: true },
        { name: "Retorno pós-procedimento", date: "2026-09-16", done: false },
        { name: "Acompanhamento clínico", date: "", done: false },
        { name: "Conclusão", date: "", done: false },
      ],
    },
    {
      id: "ortodontia-carlos",
      patientId: "carlos-henrique",
      name: "Ortodontia",
      professional: professionals[1],
      total: 6200,
      status: "Aguardando retorno",
      priority: "Alta",
      steps: [
        { name: "Avaliação", date: "2026-09-02", done: true },
        { name: "Planejamento", date: "2026-09-09", done: true },
        { name: "Próxima manutenção", date: DEMO_DATE, done: false },
        { name: "Finalização", date: "", done: false },
      ],
    },
    {
      id: "facetas-fernanda",
      patientId: "fernanda-alves",
      name: "Facetas em resina",
      professional: professionals[0],
      total: 12800,
      status: "Em andamento",
      priority: "Média",
      steps: [
        { name: "Avaliação", date: "2026-09-08", done: true },
        { name: "Planejamento estético", date: "2026-09-11", done: true },
        { name: "Aplicação das facetas", date: "2026-09-17", done: false },
        { name: "Revisão", date: "", done: false },
      ],
    },
    {
      id: "clareamento-joao",
      patientId: "joao-pedro-martins",
      name: "Clareamento",
      professional: professionals[1],
      total: 1800,
      status: "Pausado",
      priority: "Baixa",
      steps: [
        { name: "Avaliação", date: "2026-09-10", done: true },
        { name: "Sessão de clareamento", date: "2026-09-18", done: false },
        { name: "Revisão", date: "", done: false },
      ],
    },
  ],
  appointments: [
    {
      id: "a1",
      patientId: "mariana-oliveira",
      treatmentId: "implante-mariana",
      procedure: "Retorno · Implante dentário",
      date: DEMO_DATE,
      time: "09:00",
      duration: 60,
      professional: professionals[0],
      room: "Sala 01",
      status: "Confirmado",
    },
    {
      id: "a2",
      patientId: "carlos-henrique",
      treatmentId: "ortodontia-carlos",
      procedure: "Manutenção ortodôntica",
      date: DEMO_DATE,
      time: "10:30",
      duration: 30,
      professional: professionals[1],
      room: "Sala 02",
      status: "Aguardando confirmação",
    },
    {
      id: "a3",
      patientId: "ana-beatriz-souza",
      procedure: "Avaliação inicial",
      date: DEMO_DATE,
      time: "12:00",
      duration: 45,
      professional: professionals[0],
      room: "Sala 01",
      status: "Aguardando confirmação",
    },
    {
      id: "a4",
      patientId: "fernanda-alves",
      treatmentId: "facetas-fernanda",
      procedure: "Planejamento de facetas",
      date: DEMO_DATE,
      time: "14:00",
      duration: 60,
      professional: professionals[0],
      room: "Sala 01",
      status: "Confirmado",
    },
    {
      id: "a5",
      patientId: "joao-pedro-martins",
      treatmentId: "clareamento-joao",
      procedure: "Revisão · Clareamento",
      date: DEMO_DATE,
      time: "15:30",
      duration: 30,
      professional: professionals[1],
      room: "Sala 02",
      status: "Concluído",
    },
    {
      id: "a6",
      patientId: "fernanda-alves",
      treatmentId: "facetas-fernanda",
      procedure: "Aplicação das facetas",
      date: "2026-09-17",
      time: "14:00",
      duration: 90,
      professional: professionals[0],
      room: "Sala 01",
      status: "Aguardando confirmação",
    },
    {
      id: "a7",
      patientId: "joao-pedro-martins",
      treatmentId: "clareamento-joao",
      procedure: "Sessão de clareamento",
      date: "2026-09-18",
      time: "10:30",
      duration: 60,
      professional: professionals[1],
      room: "Sala 02",
      status: "Confirmado",
    },
  ],
  quotes: [
    {
      id: "o1",
      patientId: "mariana-oliveira",
      procedure: "Implante dentário",
      value: 8500,
      discount: 0,
      validity: "2026-09-30",
      status: "Aprovado",
      sent: "2026-09-08",
      approved: "2026-09-09",
      treatmentId: "implante-mariana",
    },
    {
      id: "o2",
      patientId: "ana-beatriz-souza",
      procedure: "Reabilitação estética",
      value: 4200,
      discount: 200,
      validity: "2026-09-30",
      status: "Rascunho",
    },
  ],
  charges: [
    {
      id: "m1",
      patientId: "mariana-oliveira",
      treatmentId: "implante-mariana",
      title: "Entrada 1/2",
      value: 1200,
      due: "2026-09-09",
      paid: "2026-09-09",
      method: "Pix",
      automatic: false,
    },
    {
      id: "m2",
      patientId: "mariana-oliveira",
      treatmentId: "implante-mariana",
      title: "Entrada 2/2",
      value: 1200,
      due: "2026-09-14",
      paid: "2026-09-14",
      method: "Pix",
      automatic: false,
    },
    ...[1700, 1700, 1700, 1000].map((value, index) => ({
      id: `mp${index}`,
      patientId: "mariana-oliveira",
      treatmentId: "implante-mariana",
      title: `Parcela ${index + 1}/4`,
      value,
      due: `2026-${index < 3 ? String(index + 10).padStart(2, "0") : "12"}-${
        index < 3 ? "10" : "20"
      }`,
      automatic: true,
    })),
    {
      id: "c1",
      patientId: "carlos-henrique",
      treatmentId: "ortodontia-carlos",
      title: "Parcela 1/2",
      value: 3100,
      due: "2026-09-14",
      automatic: true,
    },
    {
      id: "c2",
      patientId: "carlos-henrique",
      treatmentId: "ortodontia-carlos",
      title: "Parcela 2/2",
      value: 3100,
      due: "2026-10-14",
      automatic: true,
    },
    {
      id: "f1",
      patientId: "fernanda-alves",
      treatmentId: "facetas-fernanda",
      title: "Entrada",
      value: 5120,
      due: "2026-09-11",
      paid: "2026-09-11",
      method: "Cartão",
      automatic: false,
    },
    {
      id: "f2",
      patientId: "fernanda-alves",
      treatmentId: "facetas-fernanda",
      title: "Parcela 1/2",
      value: 3840,
      due: "2026-09-15",
      automatic: true,
    },
    {
      id: "f3",
      patientId: "fernanda-alves",
      treatmentId: "facetas-fernanda",
      title: "Parcela 2/2",
      value: 3840,
      due: "2026-10-15",
      automatic: true,
    },
    {
      id: "j1",
      patientId: "joao-pedro-martins",
      treatmentId: "clareamento-joao",
      title: "Entrada",
      value: 900,
      due: "2026-09-10",
      paid: "2026-09-10",
      method: "Pix",
      automatic: false,
    },
    {
      id: "j2",
      patientId: "joao-pedro-martins",
      treatmentId: "clareamento-joao",
      title: "Parcela final",
      value: 900,
      due: "2026-10-10",
      automatic: true,
    },
  ],
  interactions: [
    {
      id: "i1",
      patientId: "mariana-oliveira",
      date: "2026-09-15T14:32",
      title: "Confirmação enviada por WhatsApp",
      text: "Oi Mariana, tudo bem? Confirmando seu retorno amanhã às 09h.",
      kind: "WhatsApp",
    },
    {
      id: "i2",
      patientId: "mariana-oliveira",
      date: "2026-09-14T09:20",
      title: "Pagamento de R$ 1.200 registrado",
      text: "Entrada 2/2 · Pix",
      kind: "Financeiro",
    },
    {
      id: "i3",
      patientId: "mariana-oliveira",
      date: "2026-09-12T09:00",
      title: "Procedimento de implante realizado",
      text: "Sem intercorrências. Retorno pós-procedimento agendado para 16 set.",
      kind: "Clínico",
    },
    {
      id: "i4",
      patientId: "mariana-oliveira",
      date: "2026-09-09T16:00",
      title: "Orçamento aprovado",
      text: "Implante dentário · R$ 8.500",
      kind: "Orçamento",
    },
    {
      id: "i5",
      patientId: "carlos-henrique",
      date: "2026-09-09T11:40",
      title: "Planejamento ortodôntico realizado",
      text: "Próxima manutenção precisa de confirmação.",
      kind: "Clínico",
    },
    {
      id: "i6",
      patientId: "fernanda-alves",
      date: "2026-09-11T14:00",
      title: "Planejamento estético aprovado",
      text: "Aplicação de facetas agendada para 17 set.",
      kind: "Clínico",
    },
    {
      id: "i7",
      patientId: "joao-pedro-martins",
      date: "2026-09-10T10:30",
      title: "Avaliação de clareamento",
      text: "Tratamento pausado a pedido do paciente.",
      kind: "Clínico",
    },
  ],
  automations: [true, true, false, true, true],
};
export const uid = () => crypto.randomUUID();
export const currency = (value: number, detail = false) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: detail ? 2 : 0,
    maximumFractionDigits: detail ? 2 : 0,
  });
export const shortDate = (date: string) =>
  date
    ? new Date(`${date.slice(0, 10)}T12:00`)
        .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
        .replace(".", "")
        .replace(" de ", " ")
    : "Não agendada";
export const longDate = (date: string) =>
  new Date(`${date}T12:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
export const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
export const financialStatus = (charges: Charge[]) =>
  !charges.length
    ? "Sem cobrança"
    : charges.every((charge) => charge.paid)
      ? "Pago"
      : charges.some((charge) => !charge.paid && charge.due < DEMO_DATE)
        ? "Vencido"
        : charges.some((charge) => charge.paid)
          ? "Parcialmente pago"
          : "Em dia";
export const activeAppointment = (appointment: Appointment) =>
  !["Cancelado", "Faltou", "Concluído"].includes(appointment.status);
