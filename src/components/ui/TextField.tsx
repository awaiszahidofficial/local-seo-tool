import type { ComponentPropsWithRef, ReactNode } from 'react'
import { FieldFrame } from './Field'
import { controlClasses } from './fieldStyles'

type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'id'> & {
  id?: string
  label: string
  error?: string | null
  hint?: ReactNode
}

export function TextField({ id, label, error, hint, required, className, ...rest }: TextFieldProps) {
  return (
    <FieldFrame id={id} label={label} required={required} error={error} hint={hint}>
      {(controlProps) => (
        <input
          {...controlProps}
          className={`${controlClasses(Boolean(error))} ${className ?? ''}`.trim()}
          {...rest}
        />
      )}
    </FieldFrame>
  )
}
