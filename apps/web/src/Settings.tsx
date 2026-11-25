import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Plus,
  Building2,
  UsersRound,
  MessageCircle,
  Zap,
  UserRound,
  SlidersHorizontal,
  Save,
  Clock3,
  Wallet,
  HeartPulse,
  UserRoundCheck,
  ShieldCheck,
  ChevronRight,
  MapPin,
  Globe2,
} from "lucide-react";
import { useDemo } from "./store";
import { uid, type Role } from "./data";
import { Button, Field, Select, Panel, Badge, Table, Toggle, Overlay, Avatar } from "./ui";
import { ModuleHeader } from "./ModuleSurface";
const roles: Role[] = ["Administrador", "Dentista", "Secretária", "Recepção", "Financeiro"];
export function Settings() {
  const { data, update, notify, role, setRole, authMode, command, permissions } = useDemo();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sections = [
    "Minha conta",
    "Clínica",
    "Equipe e permissões",
    "WhatsApp",
    "Automações",
    "Preferências",
  ];
  const selected = sections.includes(params.get("secao") || "") ? params.get("secao")! : "Clínica";
  const [invite, setInvite] = useState(false);
  const [profile, setProfile] = useState(data.account);
  const [clinicPhone, setClinicPhone] = useState(data.clinicPhone);
  const [city, setCity] = useState(data.clinicCity);
  const isAdmin = role === "Administrador";
  const persist = async (type: string, payload: Record<string, unknown>) => {
    try {
      await command(type, payload);
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Não foi possível salvar a configuração.",
        true,
      );
      return false;
    }
  };
  const icons = [UserRound, Building2, UsersRound, MessageCircle, Zap, SlidersHorizontal];
  const descriptions = [
    "Perfil e contato",
    "Cadastro e localização",
    "Membros e funções",
    "Canal de atendimento",
    "Regras de acompanhamento",
    "Ajustes de visualização",
  ];
  const rules = [
    {
      title: "Lembrete de consulta",
      goal: "LEMBRETES",
      timing: "24 horas antes da consulta",
      channel: "WhatsApp · lembrar horário e local",
      icon: Clock3,
    },
    {
      title: "Confirmação automática",
      goal: "CONFIRMAÇÕES",
      timing: "48 horas antes do atendimento",
      channel: "WhatsApp · solicitar confirmação",
      icon: UserRoundCheck,
    },
    {
      title: "Cobrança automática",
      goal: "COBRANÇAS",
      timing: "2 dias antes do vencimento",
      channel: "WhatsApp · valor, parcela e vencimento",
      icon: Wallet,
    },
    {
      title: "Acompanhamento pós-procedimento",
      goal: "PÓS-PROCEDIMENTO",
      timing: "24 horas após o atendimento",
      channel: "WhatsApp · acompanhar recuperação",
      icon: HeartPulse,
    },
    {
      title: "Paciente sem retorno",
      goal: "CONTINUIDADE DO CUIDADO",
      timing: "7 dias sem próxima consulta",
      channel: "Criar tarefa para a recepção",
      icon: UsersRound,
    },
  ];
  return (
    <>
      <ModuleHeader
        title="Configurações"
        description="Gerencie os dados da clínica, as permissões e os canais de atendimento."
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(215px,250px)_minmax(0,1fr)]">
        <nav
          aria-label="Seções de configurações"
          className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-2 shadow-panel sm:grid-cols-3 lg:grid-cols-1 lg:p-3"
        >
          {sections.map((section, index) => {
            const Icon = icons[index];
            return (
              <button
                key={section}
                onClick={() => setParams({ secao: section })}
                aria-pressed={selected === section}
                className={`group flex min-h-12 min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors sm:px-3 lg:min-h-[3.4rem] lg:gap-2.5 ${
                  selected === section ? "bg-accent text-primary" : "text-foreground hover:bg-muted"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-md lg:size-8 ${selected === section ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{section}</span>
                  <span className="mt-0.5 hidden text-[11px] text-muted-foreground lg:block">
                    {descriptions[index]}
                  </span>
                </span>
                <ChevronRight
                  className={`hidden shrink-0 lg:block ${selected === section ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  size={14}
                />
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          {selected === "Clínica" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_14rem]">
              <Panel
                title="Dados da clínica"
                subtitle="Informações compartilhadas por toda a operação."
              >
                <form
                  className="space-y-5 px-5 pb-5"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const fields = new FormData(event.currentTarget);
                    const changes = {
                      name: String(fields.get("clinic")),
                      phone: clinicPhone,
                      city,
                    };
                    if (authMode === "authenticated") {
                      if (!(await persist("clinic.update", changes))) return;
                    } else
                      update((previous) => ({
                        ...previous,
                        clinic: changes.name,
                        clinicPhone,
                        clinicCity: city,
                      }));
                    notify("Dados da clínica atualizados.");
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Nome da clínica"
                      name="clinic"
                      defaultValue={data.clinic}
                      required
                      disabled={!isAdmin}
                    />
                    <Field label="Responsável" defaultValue={data.account.name} disabled />
                    <Field
                      label="Telefone / WhatsApp"
                      value={clinicPhone}
                      onChange={(event) => setClinicPhone(event.target.value)}
                      type="tel"
                      disabled={!isAdmin}
                    />
                    <Field
                      label="Cidade"
                      value={city}
                      onChange={(event) => setCity(event.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                  <Button type="submit" disabled={!isAdmin}>
                    <Save size={16} />
                    Salvar alterações
                  </Button>
                  {!isAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Somente o administrador pode alterar dados da clínica.
                    </p>
                  )}
                </form>
              </Panel>
              <Panel title="Dados operacionais">
                <dl className="grid gap-4 px-5 pb-5 text-sm">
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg bg-secondary p-2 text-primary">
                      <Globe2 size={16} />
                    </span>
                    <div>
                      <dt className="text-xs text-muted-foreground">Fuso horário</dt>
                      <dd className="mt-1 font-medium">América / São Paulo</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg bg-secondary p-2 text-primary">
                      <MapPin size={16} />
                    </span>
                    <div>
                      <dt className="text-xs text-muted-foreground">Moeda</dt>
                      <dd className="mt-1 font-medium">Real brasileiro (BRL)</dd>
                    </div>
                  </div>
                </dl>
              </Panel>
            </div>
          )}
          {selected === "Minha conta" && (
            <Panel title="Minha conta">
              <form
                className="space-y-5 px-5 pb-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (authMode === "authenticated") {
                    if (!(await persist("profile.update", profile))) return;
                  } else update((previous) => ({ ...previous, account: profile }));
                  notify("Dados da conta atualizados.");
                }}
              >
                <Avatar size="large" name={profile.name} />
                <Field
                  label="Nome"
                  value={profile.name}
                  onChange={(event) =>
                    setProfile((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  required
                />
                <Field
                  label="E-mail"
                  type="email"
                  value={profile.email}
                  onChange={(event) =>
                    setProfile((previous) => ({
                      ...previous,
                      email: event.target.value,
                    }))
                  }
                  required
                />
                <Field label="Função" value={role} disabled />
                <Button type="submit">Salvar minha conta</Button>
              </form>
            </Panel>
          )}
          {selected === "Equipe e permissões" && (
            <>
              <Panel
                title="Equipe"
                subtitle="Acesso proporcional à responsabilidade de cada pessoa."
                action={
                  <Button disabled={!isAdmin} onClick={() => setInvite(true)}>
                    <Plus size={15} />
                    Convidar membro
                  </Button>
                }
              >
                <Table headers={["Pessoa", "E-mail", "Função", "Status"]}>
                  {data.team.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <span className="font-medium">{member.name}</span>
                      </td>
                      <td className="text-xs">{member.email}</td>
                      <td>
                        <select
                          aria-label={`Função de ${member.name}`}
                          disabled={!isAdmin || member.id === "s"}
                          value={member.role}
                          className="rounded-lg border border-border bg-white p-2 text-xs disabled:bg-muted"
                          onChange={async (event) => {
                            const nextRole = event.target.value as Role;
                            if (authMode === "authenticated") {
                              if (
                                !(await persist("team.role.update", {
                                  memberId: member.id,
                                  role: nextRole,
                                }))
                              )
                                return;
                            } else
                              update((previous) => ({
                                ...previous,
                                team: previous.team.map((item) =>
                                  item.id === member.id ? { ...item, role: nextRole } : item,
                                ),
                              }));
                            notify("Permissão atualizada.");
                          }}
                        >
                          {roles.map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Badge>{member.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </Table>
              </Panel>
              {authMode === "demo" && (
                <div className="mt-5 rounded-xl bg-secondary p-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck size={17} />
                    Simular permissões no protótipo
                  </h3>
                  <Select
                    label="Visualizar como"
                    value={role}
                    onChange={(event) => {
                      setRole(event.target.value as Role);
                      notify(`Visualização de ${event.target.value} ativada.`);
                    }}
                  >
                    {roles.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </Select>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Administrador e Financeiro acessam valores, orçamentos e pagamentos. Perfis
                    clínicos e de recepção não visualizam esses dados. Esta simulação visual não
                    substitui autorização no servidor.
                  </p>
                </div>
              )}
            </>
          )}
          {selected === "WhatsApp" && (
            <Panel
              title="WhatsApp da clínica"
              subtitle={
                authMode === "demo"
                  ? "Simulação do atendimento, sem envio real."
                  : "Canal usado para o atendimento pelo CRM."
              }
            >
              <div className="space-y-5 px-5 pb-5">
                <div className="flex items-center gap-3 rounded-lg bg-secondary p-4">
                  <MessageCircle className="text-primary" size={23} />
                  <div>
                    <p className="text-sm font-medium">WhatsApp</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {clinicPhone || "Telefone não informado"}
                    </p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {authMode === "demo"
                    ? "Use conversas fictícias para apresentar o envio, o recebimento e a entrega de mensagens."
                    : "Consulte a configuração do canal na caixa de entrada. Os atalhos de rascunho do prontuário apenas registram o texto no histórico do paciente."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(authMode === "demo" || permissions.includes("whatsapp.inbox.read")) && (
                    <Button onClick={() => navigate("/app/whatsapp")}>
                      {authMode === "demo" ? "Abrir simulação" : "Abrir conversas"}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setParams({ secao: "Automações" })}>
                    Revisar regras de mensagem
                  </Button>
                </div>
              </div>
            </Panel>
          )}
          {selected === "Automações" && (
            <Panel
              title="Automações por objetivo"
              subtitle="As regras abaixo organizam rascunhos e tarefas. O agendamento por conversa é configurado separadamente."
            >
              <div className="divide-y divide-border">
                {rules.map((rule, index) => (
                  <div key={rule.title} className="flex gap-4 px-5 py-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                      <rule.icon size={19} />
                    </span>
                    <div className="flex-1">
                      <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                        {rule.goal}
                      </p>
                      <h3 className="mt-1 text-sm font-medium">{rule.title}</h3>
                      <p className="mt-2 text-[13px] text-muted-foreground">{rule.timing}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{rule.channel}</p>
                    </div>
                    <Toggle
                      label={`Ativar ${rule.title}`}
                      disabled={!isAdmin}
                      checked={data.automations[index]}
                      onChange={async () => {
                        if (!isAdmin) {
                          notify("Somente o administrador pode alterar automações.", true);
                          return;
                        }
                        const enabled = !data.automations[index];
                        if (authMode === "authenticated") {
                          if (
                            !(await persist("automation.set", {
                              index,
                              enabled,
                            }))
                          )
                            return;
                        } else
                          update((previous) => ({
                            ...previous,
                            automations: previous.automations.map((value, key) =>
                              key === index ? !value : value,
                            ),
                          }));
                        notify(
                          `${rule.title}: regra ${
                            data.automations[index] ? "desativada" : "ativada"
                          }${
                            authMode === "demo"
                              ? " na demonstração."
                              : ". Nenhuma mensagem externa foi enviada."
                          }`,
                        );
                      }}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {selected === "Preferências" && (
            <Panel title="Preferências da interface">
              <div className="space-y-5 px-5 pb-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium">Tabelas compactas</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mais registros na tela, mantendo a legibilidade.
                    </p>
                  </div>
                  <Toggle
                    label="Usar tabelas compactas"
                    checked={data.preferences.compact}
                    onChange={async () => {
                      const compact = !data.preferences.compact;
                      if (authMode === "authenticated")
                        await persist("preferences.update", {
                          ...data.preferences,
                          compact,
                        });
                      else
                        update((previous) => ({
                          ...previous,
                          preferences: {
                            ...previous.preferences,
                            compact,
                          },
                        }));
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium">Indicador de notificações</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Exibir um indicador no sino da barra superior.
                    </p>
                  </div>
                  <Toggle
                    label="Exibir indicador de notificações"
                    checked={data.preferences.reminders}
                    onChange={async () => {
                      const reminders = !data.preferences.reminders;
                      if (authMode === "authenticated")
                        await persist("preferences.update", {
                          ...data.preferences,
                          reminders,
                        });
                      else
                        update((previous) => ({
                          ...previous,
                          preferences: {
                            ...previous.preferences,
                            reminders,
                          },
                        }));
                    }}
                  />
                </div>
                <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                  Idioma: Português (Brasil) · Formato de data: dia, mês · Tema claro
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>
      {invite && (
        <Overlay title="Convidar membro" onClose={() => setInvite(false)}>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!isAdmin) return;
              const fields = new FormData(event.currentTarget);
              const email = String(fields.get("email"));
              if (data.team.some((member) => member.email === email)) {
                notify("Este e-mail já está na equipe.", true);
                return;
              }
              const inviteData = {
                name: String(fields.get("name")),
                email,
                role: String(fields.get("role")) as Role,
              };
              if (authMode === "authenticated") {
                if (!(await persist("team.invite", inviteData))) return;
              } else
                update((previous) => ({
                  ...previous,
                  team: [
                    ...previous.team,
                    {
                      id: uid(),
                      ...inviteData,
                      status: "Convite pendente",
                    },
                  ],
                }));
              notify(
                authMode === "authenticated"
                  ? "Convite registrado. O estado de entrega reflete a configuração de e-mail."
                  : "Convite registrado na demonstração. Nenhum e-mail foi enviado.",
              );
              setInvite(false);
            }}
          >
            <Field label="Nome" name="name" required />
            <Field label="E-mail" name="email" type="email" required />
            <Select label="Função" name="role">
              {roles.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {authMode === "demo"
                ? "Convite demonstrativo, sem envio de e-mail."
                : "O convite será registrado; o envio depende de um provedor de e-mail configurado."}
            </p>
            <Button type="submit">Registrar convite</Button>
          </form>
        </Overlay>
      )}
    </>
  );
}
