type SessionLoaderProps = {
  label: string
}

export default function SessionLoader({ label }: SessionLoaderProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-6" tabIndex={-1} data-route-focus>
      <div className="motion-loader-enter flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
        <div className="session-loader" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
        <p className="text-sm font-medium text-ink-secondary">{label}</p>
      </div>
    </main>
  )
}
