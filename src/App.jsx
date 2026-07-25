import { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Auth from './screens/Auth'
import Feed from './screens/Feed'
import Me from './screens/Me'
import Squad from './screens/Squad'
import Intake from './screens/Intake'
import PlanView from './screens/PlanView'
import BottomNav from './components/BottomNav'
import LogModal from './components/LogModal'

export default function App() {
  const { user, loading } = useAuth()
  const [logOpen, setLogOpen] = useState(false)
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
        <Route path="/me" element={<Me />} />
        <Route path="/squad" element={<Squad />} />
        <Route path="/intake" element={<Intake />} />
        <Route path="/plan" element={<PlanView />} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>

      <BottomNav onAdd={() => setLogOpen(true)} />

      <LogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onLogged={() => { setRefreshKey((k) => k + 1); nav('/feed') }}
      />
    </>
  )
}
