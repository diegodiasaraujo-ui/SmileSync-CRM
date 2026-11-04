import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { initialData, uid, type DemoData, type Patient, type Role } from "./data";

export type Action = {
  kind: "patient" | "appointment" | "quote" | "payment" | "message" | "note" | "treatment";
  patientId?: string;
  chargeId?: string;
  appointmentId?: string;
  date?: string;
  time?: string;
  text?: string;
};

type Notice = {
  id: string;
  text: string;
  error?: boolean;
  undo?: () => void;
};

export type AuthMode = "loading" | "anonymous" | "authenticated" | "demo";

type Store = {
  data: DemoData;
  update: (change: (data: DemoData) => DemoData) => void;
  role: Role;
  setRole: (role: Role) => void;
  canFinance: boolean;
  permissions: string[];
  session: Session | null;
  authMode: AuthMode;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  enterDemo: () => void;
  requestPasswordReset: (email: string) => Promise<"queued" | "not_configured">;
  command: <T = unknown>(type: string, payload: Record<string, unknown>) => Promise<T>;
  action: Action | null;
  open: (action: Action) => void;
  close: () => void;
  notify: (text: string, error?: boolean, undo?: () => void) => void;
  patient: (id: string) => Patient;
  loading: boolean;
  storageError: boolean;
  retryStorage: () => void;
  record: (patientId: string, title: string, text: string, kind?: string) => void;
};

const emptyData = (): DemoData => ({
  patients: [],
  treatments: [],
  appointments: [],
  quotes: [],
  charges: [],
  interactions: [],
  automations: [false, false, false, false, false],
  clinic: "",
  clinicPhone: "",
  clinicCity: "",
  account: { name: "", email: "" },
  team: [],
  preferences: { compact: false, reminders: true },
});

const unavailablePatient: Patient = {
  id: "",
  name: "Paciente não encontrado",
  phone: "",
  email: "",
  city: "",
  since: "",
  tags: [],
  notes: "",
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const Context = createContext<Store | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DemoData>(emptyData);
  const [authMode, setAuthMode] = useState<AuthMode>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [demoRole, setDemoRole] = useState<Role>("Administrador");
  const [action, setAction] = useState<Action | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [storageError, setStorageError] = useState(false);
  const commandChain = useRef(Promise.resolve());
  const retryKeys = useRef(new Map<string, string>());

  const notify = useCallback((text: string, error = false, undo?: () => void) => {
    const id = uid();
    setNotices((previous) => [...previous.slice(-2), { id, text, error, undo }]);
    window.setTimeout(
      () => setNotices((previous) => previous.filter((notice) => notice.id !== id)),
      undo ? 10000 : 6000,
    );
  }, []);

  const applyAuthenticatedState = useCallback(async (nextSession: Session) => {
    const response = await api.bootstrap();
    setData(response.data);
    setSession(nextSession);
    setStorageError(false);
    setAuthMode("authenticated");
  }, []);

  useEffect(() => {
    let active = true;
    api
      .session()
      .then(async ({ session: nextSession }) => {
        if (!active) return;
        await applyAuthenticatedState(nextSession);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (!(error instanceof ApiError) || error.status !== 401) setStorageError(true);
        setAuthMode("anonymous");
      });
    return () => {
      active = false;
    };
  }, [applyAuthenticatedState]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email, password);
      await applyAuthenticatedState(response.session);
    },
    [applyAuthenticatedState],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await api.register(name, email, password);
      await applyAuthenticatedState(response.session);
    },
    [applyAuthenticatedState],
  );

  const logout = useCallback(async () => {
    if (authMode === "authenticated") await api.logout();
    retryKeys.current.clear();
    setAction(null);
    setSession(null);
    setData(emptyData());
    setAuthMode("anonymous");
  }, [authMode]);

  const enterDemo = useCallback(() => {
    retryKeys.current.clear();
    const demo = structuredClone(initialData);
    setSession(null);
    setDemoRole("Administrador");
    setStorageError(false);
    setData(demo);
    setAuthMode("demo");
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const response = await api.requestPasswordReset(email);
    return response.delivery;
  }, []);

  const update = useCallback(
    (change: (current: DemoData) => DemoData) => {
      if (authMode === "authenticated") {
        notify("Esta ação ainda não possui uma mutação persistente no servidor.", true);
        return;
      }
      setData(change);
    },
    [authMode, notify],
  );

  const command = useCallback(
    <T,>(type: string, payload: Record<string, unknown>): Promise<T> => {
      if (authMode !== "authenticated")
        return Promise.reject(new Error("Comandos persistentes exigem uma sessão autenticada."));

      const fingerprint = `${type}:${stableSerialize(payload)}`;
      const idempotencyKey = retryKeys.current.get(fingerprint) ?? crypto.randomUUID();
      retryKeys.current.set(fingerprint, idempotencyKey);
      const run = commandChain.current.then(async () => {
        const response = await api.command<T>(type, payload, idempotencyKey);
        retryKeys.current.delete(fingerprint);
        setData(response.data);
        setStorageError(false);
        return response.result;
      });
      commandChain.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run.catch((error: unknown) => {
        if (error instanceof ApiError && error.status < 500) retryKeys.current.delete(fingerprint);
        setStorageError(true);
        throw error;
      });
    },
    [authMode],
  );

  const role = session?.role || demoRole;
  const permissions = session?.permissions || [];
  const canFinance =
    authMode === "demo"
      ? ["Administrador", "Financeiro"].includes(role)
      : permissions.some((permission) => permission.startsWith("finance."));

  const record = useCallback(
    (patientId: string, title: string, text: string, kind = "Operação") => {
      if (authMode === "authenticated") {
        void command("interaction.create", {
          patientId,
          title,
          text,
          kind,
        }).catch((error: unknown) =>
          notify(error instanceof Error ? error.message : "Falha ao registrar.", true),
        );
        return;
      }
      setData((previous) => ({
        ...previous,
        interactions: [
          {
            id: uid(),
            patientId,
            date: new Date().toISOString(),
            title,
            text,
            kind,
          },
          ...previous.interactions,
        ],
      }));
    },
    [authMode, command, notify],
  );

  const value = useMemo<Store>(
    () => ({
      data,
      update,
      role,
      setRole: (nextRole) => {
        if (authMode === "demo") setDemoRole(nextRole);
        else notify("As permissões reais são definidas pelo administrador da clínica.", true);
      },
      canFinance,
      permissions,
      session,
      authMode,
      login,
      register,
      logout,
      enterDemo,
      requestPasswordReset,
      command,
      action,
      open: setAction,
      close: () => setAction(null),
      notify,
      patient: (id) =>
        data.patients.find((patient) => patient.id === id) ||
        data.patients[0] ||
        unavailablePatient,
      loading: authMode === "loading",
      storageError,
      retryStorage: () => {
        if (authMode !== "authenticated") {
          setStorageError(false);
          return;
        }
        api
          .bootstrap()
          .then((response) => {
            setData(response.data);
            setStorageError(false);
            notify("Dados recarregados do servidor.");
          })
          .catch((error: unknown) =>
            notify(
              error instanceof Error ? error.message : "Não foi possível sincronizar agora.",
              true,
            ),
          );
      },
      record,
    }),
    [
      action,
      authMode,
      canFinance,
      command,
      data,
      enterDemo,
      login,
      logout,
      notify,
      permissions,
      record,
      register,
      requestPasswordReset,
      role,
      session,
      storageError,
      update,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-20 right-4 z-50 grid w-[calc(100%-32px)] max-w-md gap-2 sm:bottom-5"
      >
        {notices.map((notice) => (
          <div
            key={notice.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-sm shadow-lg"
          >
            {notice.error ? (
              <AlertCircle className="shrink-0 text-red-700" size={19} />
            ) : (
              <CheckCircle2 className="shrink-0 text-primary" size={19} />
            )}
            <span className="flex-1">{notice.text}</span>
            {notice.undo && (
              <button
                className="font-medium text-primary"
                onClick={() => {
                  notice.undo?.();
                  setNotices((previous) => previous.filter((item) => item.id !== notice.id));
                }}
              >
                Desfazer
              </button>
            )}
            <button
              aria-label="Fechar aviso"
              className="p-1 text-muted-foreground"
              onClick={() =>
                setNotices((previous) => previous.filter((item) => item.id !== notice.id))
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}

export function useDemo() {
  const context = useContext(Context);
  if (!context) throw new Error("Provider não encontrado");
  return context;
}
