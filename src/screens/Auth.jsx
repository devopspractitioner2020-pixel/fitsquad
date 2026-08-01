import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Flame } from '../components/ui'

export default function Auth() {
  const { signIn, signUp } = useAuth()
  // An invite link looks like https://…/?join=ABC123. Reading it here means
  // the new member lands in the right squad on their very first screen,
  // instead of signing up into an empty one and having to find the code.
  const invited = new URLSearchParams(window.location.search).get('join') ?? ''
  const [mode, setMode] = useState(invited ? 'signup' : 'signin')
  const [joinCode, setJoinCode] = useState(invited.toUpperCase())
  const [displayName, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setErr(''); setBusy(true)
    try {
      if (mode === 'signup') {
        if (!displayName.trim()) throw new Error('Pick a name your squad will see.')
        await signUp(email.trim(), password, displayName.trim(), joinCode)
      } else {
        await signIn(email.trim(), password)
      }
    } catch (e) {
      setErr(e.message ?? 'That did not work. Check your details and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell flex flex-col items-center justify-center px-6" style={{ paddingBottom: 40 }}>
      <div className="flex items-center gap-3 mb-8">
        <div className="w-14 h-14 rounded-full bg-mint grid place-items-center shadow-glow"><Flame size={28} /></div>
        <span className="font-display text-[34px] font-800">Fit Squad</span>
      </div>

      {invited && (
        <p className="text-mint text-sm mb-4 text-center">
          You have been invited to a squad. Sign up and you are straight in.
        </p>
      )}

      <div className="w-full bg-card/60 border border-line rounded-xl3 p-6">
        <div className="flex bg-ink/60 rounded-2xl p-1 mb-6">
          <button onClick={() => setMode('signin')} className={`flex-1 py-3 rounded-xl font-display font-700 ${mode === 'signin' ? 'bg-panel text-cream' : 'text-muted'}`}>Sign in</button>
          <button onClick={() => setMode('signup')} className={`flex-1 py-3 rounded-xl font-display font-700 ${mode === 'signup' ? 'bg-panel text-cream' : 'text-muted'}`}>Join squad</button>
        </div>

        {mode === 'signup' && (
          <>
            <label className="block mb-4">
              <span className="label">Display name</span>
              <input className="input" placeholder="What should the squad call you?" value={displayName} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block mb-4">
              <span className="label">Squad join code (optional)</span>
              <input
                className="input tracking-[0.18em] uppercase"
                placeholder="Leave blank to start your own"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
              />
            </label>
          </>
        )}
        <label className="block mb-4">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block mb-6">
          <span className="label">Password</span>
          <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {err && <p className="text-[#ff9b8a] text-sm mb-4">{err}</p>}

        <button className="btn-primary flex items-center justify-center gap-2" onClick={submit} disabled={busy}>
          {busy ? <><span className="spinner" /> Working…</> : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>
      </div>
    </div>
  )
}
