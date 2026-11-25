import type { ReactNode } from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import "./ModuleSurface.css";

export function ModuleHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="module-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="module-heading-actions">{children}</div>}
    </header>
  );
}

type ModuleMetric = {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "amber" | "red";
  onClick?: () => void;
};

export function ModuleMetrics({ items }: { items: ModuleMetric[] }) {
  return (
    <section aria-label="Indicadores do módulo" className="module-metrics">
      {items.map(({ label, value, detail, icon: Icon, tone = "blue", onClick }) => {
        const Tag = onClick ? "button" : "article";
        return (
          <Tag key={label} onClick={onClick} className="module-metric">
            <span className="module-metric-icon" data-tone={tone}>
              <Icon size={19} strokeWidth={1.9} />
            </span>
            <span className="module-metric-label">{label}</span>
            <strong>{value}</strong>
            <span className="module-metric-detail">{detail}</span>
            {onClick && <ArrowUpRight className="module-metric-arrow" size={15} />}
          </Tag>
        );
      })}
    </section>
  );
}

export function ModuleToolbar({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label} className={`module-toolbar ${className}`}>
      {children}
    </section>
  );
}
