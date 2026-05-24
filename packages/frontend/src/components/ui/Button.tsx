import { forwardRef } from 'react'
import clsx from 'clsx'

type Variant = 'default' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantStyles: Record<Variant, string> = {
  default:
    'bg-blue-600 hover:bg-blue-500 text-white border border-blue-600 hover:border-blue-500',
  ghost:
    'bg-transparent hover:bg-slate-700 text-slate-300 hover:text-white border border-transparent',
  danger:
    'bg-red-700 hover:bg-red-600 text-white border border-red-700 hover:border-red-600',
  outline:
    'bg-transparent hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500',
}

const sizeStyles: Record<Size, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
  lg: 'px-4 py-2 text-base gap-2',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center rounded font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

export default Button
