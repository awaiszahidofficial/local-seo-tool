import type { ComponentPropsWithoutRef } from 'react'

export function Table({ children, ...rest }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-surface-2" {...rest}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, className = '', ...rest }: ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      scope="col"
      className={`border-b border-line bg-surface-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap text-ink-3 ${className}`.trim()}
      {...rest}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = '', ...rest }: ComponentPropsWithoutRef<'td'>) {
  return (
    <td className={`border-b border-line-soft px-4 py-3 align-top text-ink-2 transition-colors ${className}`.trim()} {...rest}>
      {children}
    </td>
  )
}
