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
    <div className="rounded-xl border border-surface-3/60 bg-surface-2/60 p-5">
      <p className="mb-2 text-sm font-medium text-ink-muted">{label}</p>
      <p className={`text-3xl font-bold ${highlight ? 'text-brand-400' : 'text-ink-primary'}`}>
        {value}
        {suffix && <span className="ml-1 text-sm font-medium text-ink-muted">{suffix}</span>}
      </p>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}
