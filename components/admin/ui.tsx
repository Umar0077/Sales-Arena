"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** Small, consistent form primitives for the Admin Panel. */

export function Section({ title, description, children, actions, className }: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-5 backdrop-blur-xl lg:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-bold text-white">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:items-center sm:gap-6">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium text-white">{label}</label>
        {hint && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary",
          checked ? "border-primary/60 bg-primary" : "border-white/10 bg-white/10",
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </Field>
  );
}

export function Range({ label, hint, value, min, max, step = 1, onChange, format }: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-center gap-4">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[#7568FF]"
        />
        <span className="w-16 shrink-0 text-right text-sm font-semibold text-white tabular">{format ? format(value) : value}</span>
      </div>
    </Field>
  );
}

export function Choice<T extends string>({ label, hint, value, options, onChange }: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              value === o.value ? "bg-primary text-white shadow" : "text-text-secondary hover:text-white",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#070B16]/70 px-3.5 py-2.5 text-sm text-white placeholder:text-text-muted focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

export function TextField({ label, hint, value, onChange, maxLength, placeholder }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, hint, value, options, onChange }: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0D1426]">{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function PrimaryButton({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
