export default function SklandIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false"
    xmlns="http://www.w3.org/2000/svg" className={`inline-block shrink-0 align-middle ${className}`}>
    <rect width="64" height="64" rx="14" fill="#D2F322" />
    <path d="M29 9c-5 5-4 12-2 18-8 2-15 0-19-9-2 9 3 17 14 20-1 7 4 15 14 15 10 0 18-7 23-14-8 1-15-2-19-9-4-7-7-14-11-21Z" fill="#252727" />
    <path d="M29 9c-4 6-3 12 0 18 4 7 5 17-1 24 6-2 10-8 9-14-1-8-7-15-8-28Z" fill="#62636A" />
    <path d="M35 17c7-1 15 2 21 8-5 1-10 0-14-1l-10 6-10 15c-3 4-8 5-13 3l4-6 10-4 7-14c1-3 2-6 5-7Z" fill="#FFF" />
  </svg>
}
