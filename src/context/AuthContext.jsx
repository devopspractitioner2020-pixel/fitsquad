import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data))
  }, [session])

  async function signUp(email, password, displayName, joinCode) {
    // display_name and join_code ride along in user metadata. The
    // on_auth_user_created trigger (migrations/0002 + 0004) reads them and
    // creates the profile and squad membership server-side.
    //
    // Doing this from the client only worked when email confirmation was OFF
    // — with it ON there is no session yet, so the inserts were silently
    // rejected by RLS and the user got no profile and no squad.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
          ...(joinCode ? { join_code: joinCode.trim().toUpperCase() } : {}),
        },
      },
    })
    if (error) throw error

    // Belt-and-braces for projects that haven't run migration 0002 yet.
    // Only possible when we already have a session; ignore RLS rejection.
    if (data.session && data.user) {
      await supabase.from('profiles')
        .upsert({ id: data.user.id, display_name: displayName })
    }
    return data
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = { session, user: session?.user ?? null, profile, loading, signUp, signIn, signOut }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
