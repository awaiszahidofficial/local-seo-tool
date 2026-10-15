import { Icon } from './icons'

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`.trim()}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Icon name="pin" className="size-5" />
      </span>
      <span className="text-sm leading-tight font-semibold text-slate-900">
        Local SEO
        <br />
        <span className="font-medium text-slate-600">Workbench</span>
      </span>
    </span>
  )
}
