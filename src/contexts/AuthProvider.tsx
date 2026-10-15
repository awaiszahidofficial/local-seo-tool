import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isRecoveryUrl } from '../lib/auth'
import { getAuthErrorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // A recovery link carries `type=recovery` in the URL hash; capture it before the client strips it.
  const [isRecovery, setIsRecovery] = useState(() => isRecoveryUrl(window.location.hash))

  useEffect(() => {
    let active = true

    // Only update React state in this callback; calling other Supabase methods here can deadlock.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
      if (event === 'SIGNED_OUT') setIsRecovery(false)
      setLoading(false)
    })

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signUp = useCallback<AuthContextValue['signUp']>(async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) return { error: getAuthErrorMessage(error), needsEmailConfirmation: false }
      return { error: null, needsEmailConfirmation: data.session === null }
    } catch (error) {
      return { error: getAuthErrorMessage(error), needsEmailConfirmation: false }
    }
  }, [])

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return { error: error ? getAuthErrorMessage(error) : null }
    } catch (error) {
      return { error: getAuthErrorMessage(error) }
    }
  }, [])

  const signOut = useCallback<AuthContextValue['signOut']>(async () => {
    try {
      const { error } = await supabase.auth.signOut()
      return { error: error ? getAuthErrorMessage(error) : null }
    } catch (error) {
      return { error: getAuthErrorMessage(error) }
    }
  }, [])

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      return { error: error ? getAuthErrorMessage(error) : null }
    } catch (error) {
      return { error: getAuthErrorMessage(error) }
    }
  }, [])

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) return { error: getAuthErrorMessage(error) }
      setIsRecovery(false)
      return { error: null }
    } catch (error) {
      return { error: getAuthErrorMessage(error) }
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      isRecovery,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [session, loading, isRecovery, signUp, signIn, signOut, requestPasswordReset, updatePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
