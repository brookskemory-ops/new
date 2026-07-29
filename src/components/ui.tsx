/** Small shared building blocks so the tabs stay consistent. */
import { useState } from 'react'
import type { ReactNode } from 'react'

export function Panel({
  title,
  subtitle,
  help,
  children,
  className = '',
}: {
  title?: string
  subtitle?: ReactNode
  /** Longer explanation, revealed by a "?" next to the title. */
  help?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [showHelp, setShowHelp] = useState(false)

  return (
    <section
      className={`rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-sm ${className}`}
    >
      {title && (
        <header className="mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-ficsit-400 uppercase">
              {title}
            </h2>
            {help && (
              <button
                type="button"
                onClick={() => setShowHelp((open) => !open)}
                aria-expanded={showHelp}
                aria-label={showHelp ? `Hide help for ${title}` : `What is ${title}?`}
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none transition ${
                  showHelp
                    ? 'border-ficsit-500 bg-ficsit-500 text-white'
                    : 'border-slate-600 text-slate-400 hover:border-ficsit-500 hover:text-ficsit-400'
                }`}
              >
                ?
              </button>
            )}
          </div>
          {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
          {help && showHelp && (
            <div className="mt-2 space-y-2 rounded-md border border-slate-700 bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-300">
              {help}
            </div>
          )}
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * An inline term that explains itself on hover or focus. Used for the handful of
 * Satisfactory concepts the numbers depend on.
 */
export function Term({ children, definition }: { children: ReactNode; definition: string }) {
  return (
    <span
      tabIndex={0}
      title={definition}
      className="cursor-help border-b border-dotted border-slate-500 outline-none focus-visible:border-ficsit-400 focus-visible:text-ficsit-300"
    >
      {children}
    </span>
  )
}

/** A dismissible note. `id` keys the dismissal so it stays gone. */
export function Callout({
  id,
  title,
  children,
  onDismiss,
}: {
  id: string
  title: string
  children: ReactNode
  onDismiss?: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-ficsit-800/70 bg-ficsit-950/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ficsit-300">{title}</h2>
        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(id)}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">{children}</div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

const controlClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ' +
  'outline-none transition focus:border-ficsit-500 focus:ring-1 focus:ring-ficsit-500'

export function NumberInput({
  value,
  onChange,
  min = 0,
  step = 'any',
  ...rest
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number | 'any'
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'step'>) {
  return (
    <input
      {...rest}
      type="number"
      className={`${controlClass} tabular`}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      step={step}
      onChange={(event) => {
        const parsed = Number.parseFloat(event.target.value)
        onChange(Number.isFinite(parsed) ? parsed : 0)
      }}
    />
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select
      {...rest}
      className={controlClass}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  ...rest
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'bg-ficsit-600 text-white hover:bg-ficsit-500',
    secondary: 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
    ghost: 'text-slate-400 hover:text-slate-100',
  }[variant]

  return (
    <button
      {...rest}
      type={type}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${styles} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string
  value: string | number
  unit?: string
  tone?: 'default' | 'warn' | 'good'
}) {
  const toneClass = {
    default: 'text-slate-100',
    warn: 'text-amber-400',
    good: 'text-emerald-400',
  }[tone]

  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`tabular text-lg font-semibold ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
      </div>
    </div>
  )
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>
}

/**
 * Machine counts: the whole number you actually build, with the exact fractional
 * figure alongside it only when the two differ.
 */
export function Count({ value }: { value: number }) {
  const whole = Math.ceil(value - 1e-9)
  const exact = fmt(value, 3)
  return (
    <>
      {whole}
      {String(whole) !== exact && <span className="ml-1 text-xs text-slate-500">{exact}</span>}
    </>
  )
}

/** Formats a rate for display: trims noise but keeps the repeating decimals that matter. */
export function fmt(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10 ** decimals + Number.EPSILON) / 10 ** decimals
  return rounded.toLocaleString(undefined, { maximumFractionDigits: decimals })
}
