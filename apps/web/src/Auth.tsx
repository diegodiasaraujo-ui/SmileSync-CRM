import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  Eye,
  EyeOff,
  ArrowRight,
  ChevronLeft,
  Check,
  ShieldCheck,
  Building2,
  UsersRound,
  CalendarDays,
  Settings2,
  UserRound,
  MessageCircle,
} from "lucide-react";
import { useDemo } from "./store";
import { Mark, Button, Field, IconButton, Overlay, inputClass, Badge, Select } from "./ui";
function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f4f8f6]">
      <header className="px-6 py-7 sm:px-10">
        <Mark />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-12">
        <div className="w-full max-w-[440px] rounded-2xl border border-border bg-white px-7 py-9 sm:px-10">
          {children}
        </div>
      </main>
      <footer className="flex items-center justify-center gap-2 px-5 pb-6 text-xs text-muted-foreground">
        <ShieldCheck size={14} />
        Sessão protegida · não compartilhe sua senha
      </footer>
    </div>
  );
}
function PasswordField({
  label = "Senha",
  name = "password",
  autoComplete = "current-password",
  minLength = 4,
}: {
  label?: string;
  name?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      <span className="relative">
        <input
          className={`${inputClass} pr-12`}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder="Digite sua senha"
        />
        <IconButton
          label={visible ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-1 top-0.5 size-9"
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </IconButton>
      </span>
    </label>
  );
}
export function Login() {
  const navigate = useNavigate();
  const { login, enterDemo } = useDemo();
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (!String(fields.get("email")).includes("@") || String(fields.get("password")).length < 4) {
      setError("Confira o e-mail e informe uma senha com pelo menos 4 caracteres.");
      return;
    }
    setLoading(true);
    try {
      await login(String(fields.get("email")), String(fields.get("password")));
      navigate("/app");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Não foi possível entrar. Tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthFrame>
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.4px]">Bem-vindo</h1>
        <p className="mt-2 text-sm text-muted-foreground">Entre para continuar sua operação.</p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <Field
          label="E-mail"
          name="email"
          type="email"
          placeholder="voce@clinica.com.br"
          autoComplete="email"
          required
        />
        <PasswordField />
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/recuperar")}
            className="min-h-9 text-xs font-medium text-primary hover:underline"
          >
            Esqueci minha senha
          </button>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
          <ArrowRight size={16} />
        </Button>
      </form>
      <div className="my-5 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="secondary" className="w-full" onClick={() => setGoogle(true)}>
        <span className="text-base font-semibold">G</span>Continuar com Google
      </Button>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Ainda não tem uma conta?{" "}
        <button
          onClick={() => navigate("/cadastro")}
          className="min-h-9 font-medium text-primary hover:underline"
        >
          Criar minha conta
        </button>
      </p>
      <div className="mt-4 border-t border-border pt-4 text-center">
        <button
          className="min-h-9 text-xs font-medium text-primary hover:underline"
          onClick={() => {
            enterDemo();
            navigate("/app");
          }}
        >
          Explorar demonstração sem login →
        </button>
      </div>
      {google && (
        <Overlay title="Acesso com Google · demonstração" onClose={() => setGoogle(false)}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A integração OAuth ainda não está configurada neste ambiente. Use e-mail e senha ou
            entre no modo de demonstração explicitamente.
          </p>
          <Button className="mt-5 w-full" onClick={() => setGoogle(false)}>
            Entendi
          </Button>
        </Overlay>
      )}
    </AuthFrame>
  );
}
export function Register() {
  const navigate = useNavigate();
  const { register } = useDemo();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <AuthFrame>
      <h1 className="text-[26px] font-semibold">Crie sua conta.</h1>
      <p className="mb-7 mt-2 text-sm text-muted-foreground">
        Comece pelo essencial. Configure sua clínica depois.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const password = String(fields.get("password"));
          if (!/^(?=.*[A-Za-z])(?=.*\d).{10,}$/.test(password)) {
            setError("Use ao menos 10 caracteres, incluindo uma letra e um número.");
            return;
          }
          if (password !== fields.get("confirm")) {
            setError("As senhas não coincidem. Confira os dois campos.");
            return;
          }
          setLoading(true);
          setError("");
          try {
            await register(String(fields.get("name")), String(fields.get("email")), password);
            navigate("/onboarding");
          } catch (submitError) {
            setError(
              submitError instanceof Error
                ? submitError.message
                : "Não foi possível criar a conta.",
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        <Field label="Nome completo" name="name" required autoComplete="name" />
        <Field label="E-mail" type="email" name="email" required autoComplete="email" />
        <PasswordField minLength={10} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">
          Use ao menos 10 caracteres, com uma letra e um número.
        </p>
        <PasswordField
          label="Confirmar senha"
          name="confirm"
          minLength={10}
          autoComplete="new-password"
        />
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button className="w-full" type="submit" disabled={loading}>
          {loading ? "Criando conta..." : "Criar conta"}
          <ArrowRight size={16} />
        </Button>
      </form>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => navigate("/")}>
        Já tenho uma conta
      </Button>
    </AuthFrame>
  );
}
export function Recover() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useDemo();
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [delivery, setDelivery] = useState<"queued" | "not_configured">("queued");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <AuthFrame>
      {sent ? (
        <>
          <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
            <Check size={24} />
          </span>
          <h1 className="text-2xl font-semibold">Solicitação registrada.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {delivery === "queued" ? (
              <>
                Se existir uma conta para <strong>{email}</strong>, as instruções serão enviadas por
                e-mail.
              </>
            ) : (
              <>
                A solicitação foi criada, mas o provedor de e-mail deste ambiente ainda não está
                configurado. Nenhuma mensagem foi enviada.
              </>
            )}
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate("/")}>
            Voltar para entrar
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Recupere seu acesso.</h1>
          <p className="mb-6 mt-3 text-sm leading-relaxed text-muted-foreground">
            Informe o e-mail da sua conta para solicitar uma nova senha.
          </p>
          <form
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              setLoading(true);
              setError("");
              try {
                setDelivery(await requestPasswordReset(email));
                setSent(true);
              } catch (submitError) {
                setError(
                  submitError instanceof Error
                    ? submitError.message
                    : "Não foi possível registrar a solicitação.",
                );
              } finally {
                setLoading(false);
              }
            }}
          >
            <Field
              label="E-mail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Registrando..." : "Solicitar link de recuperação"}
            </Button>
          </form>
          <Button variant="ghost" className="mt-3 w-full" onClick={() => navigate("/")}>
            <ChevronLeft size={15} />
            Voltar para entrar
          </Button>
        </>
      )}
    </AuthFrame>
  );
}
export function Onboarding() {
  const { data, update, notify, authMode, command } = useDemo();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [clinic, setClinic] = useState(data.clinic);
  const [clinicCity, setClinicCity] = useState(data.clinicCity);
  const [whatsApp, setWhatsApp] = useState(false);
  const [firstPatient, setFirstPatient] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const steps = [
    "Sua conta",
    "Sua clínica",
    "Sua equipe",
    "Primeiros pacientes",
    "Primeira configuração",
  ];
  const icons = [UserRound, Building2, UsersRound, CalendarDays, Settings2];
  const Icon = icons[step];
  const advance = async () => {
    setSaving(true);
    setError("");
    try {
      if (step === 1) {
        if (authMode === "demo")
          update((previous) => ({
            ...previous,
            clinic: clinic.trim(),
            clinicCity,
          }));
        else
          await command("clinic.update", {
            name: clinic.trim(),
            city: clinicCity,
          });
      }
      if (step === 3 && firstPatient.trim()) {
        if (authMode === "demo") {
          const id = crypto.randomUUID();
          update((previous) => ({
            ...previous,
            patients: [
              ...previous.patients,
              {
                id,
                name: firstPatient.trim(),
                phone: "",
                email: "",
                city: clinicCity,
                since: new Date().toISOString().slice(0, 10),
                tags: ["Novo paciente"],
                notes: "Complete o contato antes de enviar mensagens.",
              },
            ],
          }));
        } else
          await command("patient.create", {
            name: firstPatient.trim(),
            phone: "",
            email: "",
            city: clinicCity,
            notes: "Complete o contato antes de enviar mensagens.",
          });
        setFirstPatient("");
      }
      if (step === 4) {
        if (authMode === "demo")
          update((previous) => ({
            ...previous,
            automations: previous.automations.map((value, index) =>
              index === 0 ? whatsApp : value,
            ),
          }));
        else
          await command("automation.set", {
            index: 0,
            enabled: whatsApp,
          });
        notify("Configuração inicial concluída.");
        navigate("/app");
      } else setStep((current) => current + 1);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Não foi possível salvar esta etapa.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-[76px] items-center justify-between border-b border-border bg-white px-6 sm:px-10">
        <Mark />
        <Button variant="ghost" onClick={() => navigate("/app")}>
          Fazer depois
        </Button>
      </header>
      <main className="mx-auto max-w-[680px] px-5 py-9 sm:py-12">
        <div className="mb-8 flex gap-2">
          {steps.map((name, index) => (
            <div key={name} className="flex-1">
              <div className={`h-1 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`} />
              <p
                className={`mt-2 hidden text-[11px] sm:block ${
                  index === step ? "font-medium text-primary" : "text-muted-foreground"
                }`}
              >
                {name}
              </p>
            </div>
          ))}
        </div>
        <section className="rounded-xl border border-border bg-white p-6 sm:p-9">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Icon size={22} />
          </span>
          <p className="text-xs text-muted-foreground">Etapa {step + 1} de 5</p>
          <h1 className="mt-2 text-2xl font-semibold">{steps[step]}</h1>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">
            Sem formulários longos. Você pode completar tudo depois.
          </p>
          {step === 0 && (
            <div className="space-y-4">
              <Badge>{authMode === "demo" ? "Demonstração pronta" : "Conta criada"}</Badge>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {authMode === "demo"
                  ? "O modo de demonstração usa dados totalmente fictícios e não envia registros ao servidor."
                  : "Sua conta e sua clínica foram criadas. Complete os dados essenciais para iniciar a operação."}
              </p>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <Field
                label="Nome da clínica"
                value={clinic}
                onChange={(event) => setClinic(event.target.value)}
              />
              <Field
                label="Cidade"
                value={clinicCity}
                onChange={(event) => setClinicCity(event.target.value)}
              />
              <Field label="Responsável" defaultValue={data.account.name} />
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {authMode === "demo"
                  ? "A equipe fictícia já está organizada."
                  : "Seu acesso administrativo já está ativo."}{" "}
                Convide novas pessoas em Configurações → Equipe.
              </p>
              {data.team.map((member) => (
                <div
                  key={member.id}
                  className="flex justify-between gap-3 border-b border-border pb-3 text-sm"
                >
                  <span>{member.name}</span>
                  <Badge>{member.role}</Badge>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {data.patients.length} pacientes já estão disponíveis. Se quiser, adicione um
                primeiro cadastro para começar.
              </p>
              <Field
                label="Primeiro paciente (opcional)"
                placeholder="Nome e sobrenome"
                value={firstPatient}
                onChange={(event) => setFirstPatient(event.target.value)}
              />
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-secondary p-4">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <MessageCircle size={17} />
                  WhatsApp contextual
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Prepare mensagens na ficha do paciente. Nenhum envio automático será feito.
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={whatsApp}
                  onChange={(event) => setWhatsApp(event.target.checked)}
                />
                Ativar regra de lembrete (sem envio externo)
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
            <Button
              disabled={saving || (step === 1 && !clinic.trim())}
              onClick={() => void advance()}
            >
              {saving ? "Salvando..." : step === 4 ? "Ir para o Dashboard" : "Continuar"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </section>
        <button
          disabled={saving}
          onClick={() => (step === 4 ? navigate("/app") : setStep(step + 1))}
          className="mt-5 w-full min-h-10 text-center text-xs text-muted-foreground hover:text-primary"
        >
          {step === 4 ? "Acessar o sistema agora" : "Pular esta etapa"}
        </button>
      </main>
    </div>
  );
}
