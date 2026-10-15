import type { ComponentPropsWithoutRef } from 'react'

export function Table({ children, ...rest }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm" {...rest}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, className = '', ...rest }: ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      scope="col"
      className={`border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold tracking-wide text-slate-600 uppercase ${className}`.trim()}
      {...rest}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = '', ...rest }: ComponentPropsWithoutRef<'td'>) {
  return (
    <td className={`border-b border-slate-100 px-4 py-3 align-top text-slate-700 ${className}`.trim()} {...rest}>
      {children}
    </td>
  )
}
