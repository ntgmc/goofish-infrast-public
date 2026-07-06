type BrandLogoSize = 'sm' | 'md' | 'lg'

const sizeClasses: Record<BrandLogoSize, string> = {
  sm: 'h-8 w-8 rounded-md p-0.5',
  md: 'h-10 w-10 rounded-lg p-1',
  lg: 'h-12 w-12 rounded-xl p-1.5',
}

interface BrandLogoProps {
  size?: BrandLogoSize
  className?: string
}

export default function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white/95 shadow-sm ring-1 ring-black/5 ${sizeClasses[size]} ${className}`}>
      <img
        src="/assets/logo-256.png"
        alt="MAA 基建排班优化器"
        className="h-full w-full object-contain"
        decoding="async"
      />
    </span>
  )
}
