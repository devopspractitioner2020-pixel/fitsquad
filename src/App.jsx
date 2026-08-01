import { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Auth from './screens/Auth'
import Feed from './screens/Feed'
import Me from './screens/Me'
import Squad from './screens/Squad'
import Intake from './screens/Intake'
import PlanView from './screens/PlanView'
import Saved from './screens/Saved'
import BottomNav from './components/BottomNav'
import LogModal from './components/LogModal'

export default function App() {
  const { user, loading } = useAuth()
  // null = closed. Otherwise the step to open on: 'menu' for the type picker,
  // or a type key to skip straight to that form. One value rather than an
  // open flag plus a type, so "closed but with a type" cannot happen.
  const [log, setLog] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const nav = useNavigate()

  if (loading) {
    return <div className="app-shell grid place-items-center"><span className="spinner spinner-mint" /></div>
  }

  if (!user) return <Auth />

  return (
    <>
      <Routes key={refreshKey}>
        <Route path="/feed" element={<Feed />} />
        <Route path="/me" element={<Me onLogWeight={() => setLog('weigh')} />} />
        <Route path="/squad" element={<Squad />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/plan" element={<PlanView />} />
        <Route path="/saved/:kind" element={<Saved />} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>

      <BottomNav onAdd={() => setLog('menu')} />

      {/* Keyed on the step so each opening starts from a clean form — and so
          opening straight onto 'weigh' actually lands there rather than
          reusing whatever step the last session ended on. */}
      <LogModal
        key={log ?? 'closed'}
        open={log != null}
        initialType={log === 'menu' ? null : log}
        onClose={() => setLog(null)}
        onLogged={(kind) => {
          setRefreshKey((k) => k + 1)
          // A weigh-in is not a post — it never appears in the feed, so
          // sending someone there after one shows them no evidence that
          // anything happened. Staying put puts them in front of the chart
          // that just moved.
          if (kind !== 'weigh') nav('/feed')
        }}
      />
    </>
  )
}
