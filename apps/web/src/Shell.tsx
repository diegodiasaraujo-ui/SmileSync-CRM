import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useNavigation } from "react-router";
import {
  LayoutDashboard,
  UsersRound,
  CalendarDays,
  Activity,
  FileText,
  Wallet,
  Settings2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Bell,
  CircleHelp,
  ChevronDown,
  ArrowRight,
  LogOut,
  Menu,
  X,
  Command,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { useDemo } from "./store";
import { Mark, Button, IconButton, Avatar, Overlay, Badge, Skeleton, Empty } from "./ui";
import { DEMO_DATE, shortDate, currency } from "./data";
import { ActionLayer } from "./Actions";
import { FINANCE_MODULE_LABEL, TREATMENTS_MODULE_LABEL } from "./moduleLabels";
const navigation = [
  { title: "Dashboard", path: "/app", icon: LayoutDashboard },
  { title: "Pacientes", path: "/app/pacientes", icon: UsersRound },
  { title: "Agenda", path: "/app/agenda", icon: CalendarDays },
  { title: TREATMENTS_MODULE_LABEL, path: "/app/tratamentos", icon: Activity },
  {
    title: "Orçamentos",
    path: "/app/orcamentos",
    icon: FileText,
    financial: true,
  },
  {
    title: FINANCE_MODULE_LABEL,
    path: "/app/financeiro",
    icon: Wallet,
    financial: true,
  },
  { title: "Configurações", path: "/app/configuracoes", icon: Settings2 },
];
export function Shell() {
  const { data, role, canFinance, storageError, retryStorage, loading, authMode, logout, notify } =
    useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = useNavigation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [popup, setPopup] = useState<"search" | "notifications" | "help" | "profile" | null>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPopup((previous) => (previous === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    setMobile(false);
    setPopup(null);
  }, [location.pathname]);
  const matchingNav = navigation.find(
    (item) => item.path !== "/app" && location.pathname.startsWith(item.path),
  );
  const goto = (path: string) => {
    navigate(path);
    setPopup(null);
    setMobile(false);
  };
  const links = navigation.filter((item) => !item.financial || canFinance);
  const nav = (
    <>
      {links.map((item, index) => (
        <div key={item.path}>
          {item.title === "Configurações" && !collapsed && (
            <p className="mb-2 mt-8 px-3 text-[11px] font-medium tracking-[0.13em] text-muted-foreground">
              GESTÃO
            </p>
          )}
          {index === 0 && !collapsed && (
            <p className="mb-3 px-3 text-[11px] font-medium tracking-[0.13em] text-muted-foreground">
              OPERAÇÃO
            </p>
          )}
          <NavLink
            end={item.path === "/app"}
            to={item.path}
            title={item.title}
            className={({ isActive }) =>
              `mb-1 flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors ${
                isActive
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${collapsed ? "justify-center" : ""}`
            }
          >
            <item.icon size={18} strokeWidth={1.7} />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </div>
      ))}
    </>
  );
  return (
    <div
      className={`flex min-h-dvh bg-background ${
        data.preferences.compact ? "[&_tbody_td]:py-2" : ""
      }`}
    >
      <a
        href="#main"
        className="fixed left-4 top-2 z-50 -translate-y-20 rounded-lg bg-primary px-4 py-3 text-white focus:translate-y-0"
      >
        Ir para o conteúdo
      </a>
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-[#fbfcfc] p-4 transition-[width] lg:flex ${
          collapsed ? "w-[76px]" : "w-[226px]"
        }`}
      >
        <div className={`mb-8 mt-3 flex ${collapsed ? "justify-center" : "px-2"}`}>
          <Mark compact={collapsed} />
        </div>
        <nav aria-label="Navegação principal" className="flex-1">
          {nav}
        </nav>
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setPopup("profile")}
            aria-label="Abrir perfil do usuário"
            title="Perfil e preferências"
            className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-muted ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Avatar name={data.account.name} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{data.account.name}</span>
                  <span className="block truncate pt-1 text-xs text-muted-foreground">{role}</span>
                </span>
                <ChevronDown size={14} />
              </>
            )}
          </button>
          <div
            className={`mt-3 flex items-center ${
              collapsed ? "justify-center" : "justify-between px-2"
            }`}
          >
            {!collapsed && (
              <span className="text-[11px] text-muted-foreground">
                SMILESYNC <span className="ml-1 text-primary">by LOGOS</span>
              </span>
            )}
            <IconButton
              label={collapsed ? "Expandir menu" : "Recolher menu"}
              className="size-8"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-border bg-white/95 px-4 backdrop-blur-sm sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton
              label="Abrir menu"
              className="lg:hidden"
              onClick={() => {
                setCollapsed(false);
                setMobile(true);
              }}
            >
              <Menu size={20} />
            </IconButton>
            <span className="hidden size-8 items-center justify-center rounded-lg bg-secondary text-primary sm:flex">
              <Building2 size={17} />
            </span>
            <div className="min-w-0">
              <p className="max-w-[260px] truncate text-xs font-medium xl:max-w-none">
                {data.clinic}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.clinicCity} <span className="hidden xl:inline">· Clínica odontológica</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <button
              onClick={() => setPopup("search")}
              aria-label="Busca global, Control K"
              className="flex h-9 items-center gap-2 rounded-lg bg-muted/65 px-3 text-xs text-muted-foreground xl:w-[280px]"
            >
              <Search size={16} />
              <span className="hidden xl:inline">Buscar na clínica...</span>
              <kbd className="ml-auto hidden rounded border border-border bg-white px-1.5 py-0.5 text-[11px] xl:inline">
                ⌘ K
              </kbd>
            </button>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <IconButton
              label="Notificações"
              className="relative"
              onClick={() => setPopup("notifications")}
            >
              <Bell size={19} />
              {data.preferences.reminders && (
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" />
              )}
            </IconButton>
            <IconButton
              label="Ajuda e atalhos"
              className="hidden sm:flex"
              onClick={() => setPopup("help")}
            >
              <CircleHelp size={19} />
            </IconButton>
            <button
              aria-label="Meu perfil"
              onClick={() => setPopup("profile")}
              className="rounded-full"
            >
              <Avatar name={data.account.name} />
            </button>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto max-w-[1720px] px-4 pb-24 pt-6 outline-none sm:px-7 lg:pb-8 xl:px-8"
        >
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Operação <span className="mx-2 text-slate-300">/</span>
              <span className="text-foreground">{matchingNav?.title || "Dashboard"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              {authMode === "demo"
                ? "Demonstração · dados fictícios"
                : "Conectado · dados persistidos"}
            </span>
          </div>
          {storageError && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"
            >
              <span>
                Não foi possível sincronizar com o servidor. Nenhuma alteração pendente será
                apresentada como concluída.
              </span>
              <Button variant="secondary" onClick={retryStorage}>
                Tentar novamente
              </Button>
            </div>
          )}
          {loading || navigationState.state === "loading" ? <Skeleton /> : <Outlet />}
        </main>
      </div>
      <nav
        aria-label="Navegação mobile"
        className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-border bg-white px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {navigation
          .filter(
            (item) =>
              ["/app", "/app/agenda", "/app/pacientes"].includes(item.path) ||
              (item.path === "/app/financeiro" && canFinance),
          )
          .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/app"}
              className={({ isActive }) =>
                `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] leading-tight ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`
              }
            >
              <item.icon size={20} />
              {item.title === "Dashboard" ? "Início" : item.title}
            </NavLink>
          ))}
        <button
          onClick={() => {
            setCollapsed(false);
            setMobile(true);
          }}
          className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground"
        >
          <Menu size={20} />
          Mais
        </button>
      </nav>
      {mobile && (
        <Overlay title="Navegação" onClose={() => setMobile(false)} drawer>
          <div className="mb-8">
            <Mark />
          </div>
          <nav aria-label="Módulos da clínica">{nav}</nav>
          <Button
            variant="ghost"
            className="mt-6"
            onClick={() => {
              setMobile(false);
              setPopup("help");
            }}
          >
            <CircleHelp size={17} />
            Ajuda e suporte
          </Button>
        </Overlay>
      )}
      {popup === "search" && (
        <GlobalSearch
          search={search}
          setSearch={setSearch}
          goto={goto}
          close={() => setPopup(null)}
        />
      )}
      {popup === "notifications" && (
        <Overlay title="Notificações" onClose={() => setPopup(null)} drawer>
          <p className="mb-5 text-xs text-muted-foreground">
            {authMode === "demo"
              ? "Atualizações dos dados fictícios"
              : "Atualizações da operação da clínica"}
          </p>
          {data.appointments
            .filter((item) => item.status === "Aguardando confirmação")
            .map((item) => (
              <button
                key={item.id}
                onClick={() => goto(`/app/agenda?consulta=${item.id}&data=${item.date}`)}
                className="flex w-full items-start gap-3 border-b border-border py-4 text-left"
              >
                <CalendarDays size={18} className="mt-1 shrink-0 text-amber-700" />
                <span className="flex-1 text-sm">
                  {data.patients.find((patient) => patient.id === item.patientId)?.name}
                  <small className="mt-1 block text-xs text-muted-foreground">
                    Consulta sem confirmação · {shortDate(item.date)} · {item.time}
                  </small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          {canFinance &&
            data.charges
              .filter((charge) => !charge.paid && charge.due < DEMO_DATE)
              .map((charge) => (
                <button
                  key={charge.id}
                  onClick={() => goto(`/app/financeiro?paciente=${charge.patientId}`)}
                  className="flex w-full items-start gap-3 border-b border-border py-4 text-left"
                >
                  <Wallet size={18} className="mt-1 text-red-700" />
                  <span className="flex-1 text-sm">
                    {currency(charge.value)} vencidos
                    <small className="mt-1 block text-xs text-muted-foreground">
                      {data.patients.find((patient) => patient.id === charge.patientId)?.name} ·{" "}
                      {shortDate(charge.due)}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
        </Overlay>
      )}
      {popup === "help" && <Help close={() => setPopup(null)} />}
      {popup === "profile" && (
        <Overlay title="Minha conta" onClose={() => setPopup(null)}>
          <div className="mb-5 flex gap-3">
            <Avatar size="large" name={data.account.name} />
            <div>
              <h3 className="font-semibold">{data.account.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{role}</p>
              <p className="mt-1 text-xs text-muted-foreground">{data.clinic}</p>
            </div>
          </div>
          {["Minha conta", "Clínica", "Equipe e permissões", "Preferências"].map((section) => (
            <button
              key={section}
              className="flex min-h-12 w-full items-center justify-between border-b border-border text-sm"
              onClick={() => goto(`/app/configuracoes?secao=${encodeURIComponent(section)}`)}
            >
              {section}
              <ArrowRight size={16} />
            </button>
          ))}
          <Button
            variant="danger"
            className="mt-5 w-full"
            onClick={async () => {
              try {
                await logout();
                goto("/");
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : "Não foi possível encerrar a sessão.",
                  true,
                );
              }
            }}
          >
            <LogOut size={16} />
            Sair
          </Button>
        </Overlay>
      )}
      <ActionLayer />
    </div>
  );
}
function GlobalSearch({
  search,
  setSearch,
  goto,
  close,
}: {
  search: string;
  setSearch: (value: string) => void;
  goto: (path: string) => void;
  close: () => void;
}) {
  const { data, canFinance } = useDemo();
  const query = search.toLocaleLowerCase("pt-BR");
  const matched = data.patients.filter((patient) =>
    [
      patient.name,
      patient.phone,
      patient.email,
      ...data.treatments.filter((item) => item.patientId === patient.id).map((item) => item.name),
      ...data.appointments
        .filter((item) => item.patientId === patient.id)
        .map((item) => item.procedure),
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(query),
  );
  const results = matched.flatMap((patient) => [
    {
      category: "Paciente",
      title: patient.name,
      path: `/app/pacientes/${patient.id}`,
    },
    ...data.appointments
      .filter((item) => item.patientId === patient.id)
      .map((item) => ({
        category: "Agendamento",
        title: `${patient.name} · ${shortDate(item.date)} · ${item.time}`,
        path: `/app/agenda?consulta=${item.id}&data=${item.date}`,
      })),
    ...data.treatments
      .filter((item) => item.patientId === patient.id)
      .map((item) => ({
        category: "Tratamento",
        title: `${item.name} · ${patient.name}`,
        path: `/app/tratamentos/${item.id}`,
      })),
    ...(canFinance
      ? data.charges
          .filter((item) => item.patientId === patient.id && !item.paid)
          .slice(0, 1)
          .map((item) => ({
            category: FINANCE_MODULE_LABEL,
            title: `${item.title} · ${currency(item.value)}`,
            path: `/app/financeiro?paciente=${patient.id}`,
          }))
      : []),
  ]);
  return (
    <Overlay title="Buscar na clínica" onClose={close}>
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border p-3">
        <Search size={18} />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome do paciente..."
          aria-label="Pesquisar pacientes e registros relacionados"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      {!search ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">ACESSO RÁPIDO</p>
          {navigation
            .filter((item) => !item.financial || canFinance)
            .map((item) => (
              <button
                key={item.path}
                onClick={() => goto(item.path)}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-sm hover:bg-muted"
              >
                <item.icon size={17} />
                {item.title}
              </button>
            ))}
        </div>
      ) : results.length ? (
        results.slice(0, 15).map((result, index) => (
          <button
            key={index}
            onClick={() => goto(result.path)}
            className="flex w-full items-center justify-between gap-2 border-b border-border py-3 text-left"
          >
            <span>
              <small className="text-xs text-muted-foreground">{result.category}</small>
              <span className="mt-1 block text-sm">{result.title}</span>
            </span>
            <ArrowRight size={16} />
          </button>
        ))
      ) : (
        <Empty
          title="Nenhum registro encontrado"
          text="Tente pesquisar pelo nome de um paciente."
        />
      )}
    </Overlay>
  );
}
function Help({ close }: { close: () => void }) {
  const [section, setSection] = useState("Atalhos");
  const { notify, authMode } = useDemo();
  return (
    <Overlay title="Ajuda e suporte" onClose={close}>
      <div className="mb-5 flex flex-wrap gap-2">
        {["Atalhos", "Central de ajuda", "Suporte", "Reportar problema"].map((item) => (
          <Button
            key={item}
            variant={section === item ? "primary" : "secondary"}
            onClick={() => setSection(item)}
          >
            {item}
          </Button>
        ))}
      </div>
      {section === "Atalhos" ? (
        <div className="space-y-4">
          <p className="flex justify-between text-sm">
            Busca global
            <kbd className="rounded bg-muted px-2 py-1 text-xs">Ctrl / ⌘ K</kbd>
          </p>
          <p className="flex justify-between text-sm">
            Fechar janela
            <kbd className="rounded bg-muted px-2 py-1 text-xs">Esc</kbd>
          </p>
          <p className="flex justify-between text-sm">
            Navegar por controles
            <kbd className="rounded bg-muted px-2 py-1 text-xs">Tab</kbd>
          </p>
        </div>
      ) : section === "Central de ajuda" ? (
        <div className="space-y-4 text-sm leading-relaxed">
          <h3 className="font-semibold">Comece pelo paciente</h3>
          <p>
            Cadastre um paciente, agende uma avaliação e crie um orçamento. Após aprovar, converta
            em tratamento e configure as parcelas.
          </p>
          <h3 className="font-semibold">Mantenha o contexto</h3>
          <p>
            A ficha reúne consultas, evolução clínica, documentos e pagamentos. Relatórios ficam no
            módulo correspondente.
          </p>
          <Badge>
            {authMode === "demo"
              ? "Dados fictícios · demonstração local"
              : "Dados persistidos da clínica"}
          </Badge>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            notify(
              "Solicitação mantida somente nesta tela. O canal externo de suporte ainda não está configurado.",
            );
            close();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Descreva{" "}
            {section === "Suporte" ? "sua dúvida" : "o problema e os passos para reproduzir"}. O
            canal externo de suporte ainda não está configurado; nenhum chamado será enviado.
          </p>
          <label className="grid gap-2 text-sm">
            Descrição
            <textarea required className="min-h-32 rounded-lg border border-border p-3" />
          </label>
          <Button type="submit">Concluir rascunho</Button>
        </form>
      )}
    </Overlay>
  );
}
