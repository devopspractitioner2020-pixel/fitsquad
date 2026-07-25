import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Flame } from '../components/ui'

export default function Auth() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // signin | signup
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
        await signUp(email.trim(), password, displayName.trim())
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

      <div className="w-full bg-card/60 border border-line rounded-xl3 p-6">
        <div className="flex bg-ink/60 rounded-2xl p-1 mb-6">
          <button onClick={() => setMode('signin')} className={`flex-1 py-3 rounded-xl font-display font-700 ${mode === 'signin' ? 'bg-panel text-cream' : 'text-muted'}`}>Sign in</button>
          <button onClick={() => setMode('signup')} className={`flex-1 py-3 rounded-xl font-display font-700 ${mode === 'signup' ? 'bg-panel text-cream' : 'text-muted'}`}>Join squad</button>
        </div>

        {mode === 'signup' && (
          <div className="mb-4">
            <label className="label">Display name</label>
            <input className="input" placeholder="What should the squad call you?" value={displayName} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="mb-4">
          <label className="label">Email</label>
          <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mb-6">
          <label className="label">Password</label>
          <input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {err && <p className="text-[#ff9b8a] text-sm mb-4">{err}</p>}

        <button className="btn-primary flex items-center justify-center gap-2" onClick={submit} disabled={busy}>
          {busy ? <><span className="spinner" /> Working…</> : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>
      </div>
    </div>
  )
}
