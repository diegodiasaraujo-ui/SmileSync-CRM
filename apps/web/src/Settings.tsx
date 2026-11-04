import { useState } from "react";
import { useSearchParams } from "react-router";
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
} from "lucide-react";
import { useDemo } from "./store";
import { uid, type Role } from "./data";
import { Header, Button, Field, Select, Panel, Badge, Table, Toggle, Overlay, Avatar } from "./ui";
const roles: Role[] = ["Administrador", "Dentista", "Secretária", "Recepção", "Financeiro"];
export function Settings() {
  const { data, update, notify, role, setRole, authMode, command } = useDemo();
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
      <Header
        title="Configurações"
        subtitle="Organize a clínica, os acessos e as regras da operação."
      />
      <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
        <nav aria-label="Seções de configurações" className="flex gap-1 overflow-x-auto lg:block">
          {sections.map((section, index) => {
            const Icon = icons[index];
            return (
              <button
                key={section}
                onClick={() => setParams({ secao: section })}
                aria-pressed={selected === section}
                className={`mb-1 flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13px] lg:w-full ${
                  selected === section
                    ? "bg-accent font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon size={17} />
                {section}
              </button>
            );
          })}
        </nav>
        <div>
          {selected === "Clínica" && (
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
                <p className="text-xs text-muted-foreground">
                  Fuso horário: América / São Paulo · Moeda: Real brasileiro
                </p>
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
                  ? "Demonstração do fluxo de rascunhos, sem envio."
                  : "Integração oficial ainda não configurada."
              }
            >
              <div className="space-y-5 px-5 pb-5">
                <div className="flex items-center gap-3 rounded-lg bg-secondary p-4">
                  <MessageCircle className="text-primary" size={23} />
                  <div>
                    <p className="text-sm font-medium">WhatsApp Business</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {clinicPhone || "Telefone não informado"}
                    </p>
                  </div>
                  <Badge>Não configurada</Badge>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {authMode === "demo"
                    ? "No modo de demonstração, as mensagens ficam apenas nos dados fictícios desta sessão. Nenhuma conversa é aberta e nada é enviado."
                    : "As ações de mensagem salvam somente um rascunho no SmileSync. Nenhuma conversa é aberta e nenhum conteúdo é enviado até a API oficial do WhatsApp Business ser configurada."}
                </p>
                <Button variant="secondary" onClick={() => setParams({ secao: "Automações" })}>
                  Revisar regras de mensagem
                </Button>
              </div>
            </Panel>
          )}
          {selected === "Automações" && (
            <Panel
              title="Automações por objetivo"
              subtitle="As regras são persistidas, mas o executor e o envio externo ainda não estão configurados."
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
