export default function MetricCard({
  label,
  value,
  suffix,
  note,
  highlight = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div className="tool-inset p-4 sm:p-5">
      <p className="mb-2 text-sm font-medium text-ink-muted">{label}</p>
      <p className={`font-mono text-3xl font-semibold tracking-[-0.03em] ${highlight ? 'text-brand-300' : 'text-ink-primary'}`}>
        {value}
        {suffix && <span className="ml-1 text-sm font-medium text-ink-muted">{suffix}</span>}
      </p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}
