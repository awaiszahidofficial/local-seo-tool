import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthActionResult = { error: string | null }

export type SignUpResult = AuthActionResult & {
  /** True when the account was created but the user must confirm their email before signing in. */
  needsEmailConfirmation: boolean
}

export type AuthContextValue = {
  user: User | null
  session: Session | null
  /** True until the persisted session (if any) has been read. */
  loading: boolean
  /** True while the user arrived through a password-recovery link and has not set a new password yet. */
  isRecovery: boolean
  signUp: (email: string, password: string) => Promise<SignUpResult>
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
  requestPasswordReset: (email: string) => Promise<AuthActionResult>
  updatePassword: (newPassword: string) => Promise<AuthActionResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
