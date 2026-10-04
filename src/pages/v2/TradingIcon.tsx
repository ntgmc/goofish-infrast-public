export default function TradingIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d="m4 8 8-4 8 4-8 4-8-4Z" />
    <path d="M4 8v7.5l5 2.5M20 8v4M12 12v4" />
    <path d="M12 19h8m-2-2 2 2-2 2M20 14h-8m2-2-2 2 2 2" />
  </svg>
}
