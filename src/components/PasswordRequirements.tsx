import { getPasswordRuleStatus } from '../lib/validation'
import { Icon } from './icons'

/** Live checklist of password requirements, driven by the same rules the validator uses. */
export function PasswordRequirements({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="space-y-1 text-sm">
      {getPasswordRuleStatus(password).map(({ rule, met }) => (
        <li key={rule.id} className={`flex items-center gap-2 ${met ? 'text-good' : 'text-ink-2'}`}>
          <Icon name={met ? 'check' : 'info'} className="size-4 shrink-0" />
          <span>
            {rule.label}
            <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
