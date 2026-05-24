import clsx from 'clsx'

interface BadgeProps {
  method: string
  className?: string
}

const methodStyles: Record<string, string> = {
  GET: 'bg-blue-900/50 text-blue-300 border border-blue-700',
  POST: 'bg-green-900/50 text-green-300 border border-green-700',
  PUT: 'bg-amber-900/50 text-amber-300 border border-amber-700',
  PATCH: 'bg-purple-900/50 text-purple-300 border border-purple-700',
  DELETE: 'bg-red-900/50 text-red-300 border border-red-700',
}

export default function Badge({ method, className }: BadgeProps) {
  const upper = method.toUpperCase()
  const style = methodStyles[upper] ?? 'bg-slate-700 text-slate-300 border border-slate-600'

  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-semibold',
        style,
        className,
      )}
    >
      {upper}
    </span>
  )
}
