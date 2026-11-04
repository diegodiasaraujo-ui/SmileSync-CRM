import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { X, ArrowUpRight, Search, Check, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";

export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="SmileSync">
      <span className="relative flex size-8 shrink-0 -rotate-12 items-center justify-center rounded-[10px] border-2 border-primary">
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" />
        <span className="mt-2 h-2 w-3 rounded-b-full border-b-2 border-primary" />
      </span>
      {!compact && (
        <span className="text-[23px] font-semibold tracking-[-0.7px]">
          Smile<span className="text-primary">Sync</span>
        </span>
      )}
    </div>
  );
}
export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
}) {
  const colors = {
    primary: "bg-primary text-white hover:bg-[#19584f]",
    secondary: "border border-border bg-white text-foreground hover:bg-muted",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${colors[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      title={label}
      aria-label={label}
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  const text = String(children);
  const tone = /Vencido|Cancelado|Faltou|Recusado|Alta|Expirado/.test(text)
    ? "bg-red-50 text-red-700"
    : /Aguardando|Parcial|Rascunho|Média|Vencendo|Sem retorno/.test(text)
      ? "bg-amber-50 text-amber-800"
      : /Confirmado|Concluído|Pago|Ativ|Aprovado|Em andamento|Em dia/.test(text)
        ? "bg-emerald-50 text-emerald-800"
        : /cidade|Visualizado|Enviado|Encaixe|Em atendimento|Remarcado/.test(text)
          ? "bg-blue-50 text-blue-800"
          : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${tone}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-65" />
      {children}
    </span>
  );
}
export function Avatar({
  name = "Sidney Almeida",
  size = "normal",
}: {
  name?: string;
  size?: "normal" | "large";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-primary ${
        size === "large" ? "size-14 text-xl" : "size-9 text-xs"
      }`}
    >
      {name
        .replace(/^Dra?\.\s*/, "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")}
    </span>
  );
}
export const inputClass =
  "min-h-10 min-w-0 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-[#adbfb8] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-red-600";
export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      <input {...props} className={`${inputClass} ${props.className || ""}`} />
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-medium">
      {label}
      <select {...props} className={inputClass}>
        {children}
      </select>
    </label>
  );
}
export function Header({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-[25px] font-semibold tracking-[-0.5px] sm:text-[27px]">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-xl border border-border bg-card ${className}`}
    >
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-5">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {children}
      <ChevronRight size={14} />
    </button>
  );
}
export function Metric({
  label,
  value,
  detail,
  attention,
  onClick,
}: {
  label: string;
  value: string | number;
  detail: string;
  attention?: boolean;
  onClick?: () => void;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      onClick={onClick}
      className={`group min-w-0 px-5 py-5 text-left transition-colors disabled:cursor-default ${
        onClick ? "hover:bg-muted/60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {onClick && <ArrowUpRight size={14} className="opacity-50 group-hover:opacity-100" />}
      </div>
      <div
        className={`mt-2 text-[27px] font-semibold tracking-[-0.5px] tabular-nums ${
          attention ? "text-amber-800" : ""
        }`}
      >
        {value}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
    </Component>
  );
}
export function Empty({
  title = "Nenhum resultado encontrado",
  text = "Ajuste a busca ou os filtros para encontrar o que precisa.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <span className="rounded-full bg-muted p-3 text-muted-foreground">
        <Search size={22} />
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
export function Skeleton() {
  return (
    <div role="status" aria-label="Carregando informações" className="space-y-6">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-border" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-xl bg-border/60" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-border/50" />
    </div>
  );
}
export function Overlay({
  title,
  children,
  onClose,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`fixed max-h-dvh w-full bg-white p-0 text-foreground shadow-xl backdrop:bg-[#152e29]/25 backdrop:backdrop-blur-[2px] ${
        drawer
          ? "inset-y-0 left-auto right-0 m-0 h-dvh max-w-lg rounded-none"
          : "inset-0 m-auto max-h-[90dvh] max-w-lg rounded-xl"
      }`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-6 py-4">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <IconButton label="Fechar" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="overflow-y-auto px-6 py-5">{children}</div>
    </dialog>,
    document.body,
  );
}
export function Tabs({
  tabs,
  selected,
  onChange,
}: {
  tabs: string[];
  selected: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="mb-6 flex overflow-x-auto border-b border-border" aria-label="Seções">
      {tabs.map((tab) => (
        <button
          key={tab}
          aria-pressed={selected === tab}
          onClick={() => onChange(tab)}
          className={`min-h-12 shrink-0 border-b-2 px-4 text-[13px] font-medium ${
            selected === tab
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="min-w-28">
      <div className="mb-2 text-xs text-muted-foreground">
        {done} de {total} etapas
      </div>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} de ${total} etapas concluídas`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${index < done ? "bg-primary" : "bg-border"}`}
          />
        ))}
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        checked ? "bg-primary" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute top-1 flex size-5 items-center justify-center rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      >
        {checked && <Check size={12} className="text-primary" />}
      </span>
    </button>
  );
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left text-[13px]">
        <thead className="bg-muted/65 text-xs font-medium text-muted-foreground">
          <tr>
            {headers.map((header, index) => (
              <th key={`${header}${index}`} scope="col" className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr:hover]:bg-muted/40 [&_td]:px-4 [&_td]:py-3.5">
          {children}
        </tbody>
      </table>
    </div>
  );
}
export function exportCSV(name: string, headers: string[], rows: (string | number)[][]) {
  const escape = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""')}"`;
  const blob = new Blob(
    ["\uFEFF", [headers, ...rows].map((row) => row.map(escape).join(";")).join("\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
