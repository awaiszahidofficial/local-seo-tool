import { useId, type ReactNode } from 'react'

export type FieldControlProps = {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
  'aria-required'?: true
}

type FieldFrameProps = {
  id?: string
  label: string
  required?: boolean
  error?: string | null
  hint?: ReactNode
  children: (controlProps: FieldControlProps) => ReactNode
}

/** Shared label / hint / error wiring so every form control is announced consistently. */
export function FieldFrame({ id, label, required, error, hint, children }: FieldFrameProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  const errorId = `${controlId}-error`
  const hintId = `${controlId}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div>
      <label htmlFor={controlId} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        ) : null}
      </label>
      {children({
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-slate-600">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
