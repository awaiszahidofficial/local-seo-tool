import type { ComponentPropsWithRef, ReactNode } from 'react'
import { FieldFrame } from './Field'
import { controlClasses } from './fieldStyles'

type TextAreaFieldProps = Omit<ComponentPropsWithRef<'textarea'>, 'id'> & {
  id?: string
  label: string
  error?: string | null
  hint?: ReactNode
}

export function TextAreaField({ id, label, error, hint, required, className, ...rest }: TextAreaFieldProps) {
  return (
    <FieldFrame id={id} label={label} required={required} error={error} hint={hint}>
      {(controlProps) => (
        <textarea
          {...controlProps}
          className={`${controlClasses(Boolean(error))} ${className ?? ''}`.trim()}
          {...rest}
        />
      )}
    </FieldFrame>
  )
}
