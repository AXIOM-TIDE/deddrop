import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import CreatePage from './pages/CreatePage'
import DropPage from './pages/DropPage'
import { useStore } from './lib/store'
import { handleZkLoginCallback } from './lib/zkLogin'

function Nav() {
  const { session } = useStore()
  const loc = useLocation()

  return (
    <nav
      style={{
        background: '#0c0c0e',
        borderBottom: '1px solid #1e1e26',
        padding: '0 16px',
      }}
    >
      <div
        style={{
          maxWidth: '672px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '56px',
        }}
      >
        <Link
          to="/"
          style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            fontWeight: 700,
            fontSize: '15px',
            letterSpacing: '0.12em',
            color: '#c8a96e',
            textDecoration: 'none',
          }}
        >
          DEDDROP
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {loc.pathname !== '/' && (
            <Link
              to="/create"
              style={{
                fontSize: '13px',
                color: '#525260',
                textDecoration: 'none',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f0ede6')}
              onMouseLeave={e => (e.currentTarget.style.color = '#525260')}
            >
              Create a dead drop
            </Link>
          )}
          {session && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '1px' }}>
                Field ID
              </div>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                  fontSize: '10px',
                  color: '#525260',
                }}
              >
                {session.address.slice(0, 6)}…{session.address.slice(-4)}
              </span>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

function Landing() {
  return (
    <div style={{ maxWidth: '672px', margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1
          style={{
            fontSize: '44px',
            fontWeight: 800,
            color: '#f0ede6',
            lineHeight: 1.15,
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          Lock it.{' '}
          <span style={{ color: '#c8a96e' }}>Link it.</span>
          <br />Collect.
        </h1>
        <p style={{ color: '#9898a8', fontSize: '16px', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 }}>
          Anonymous paid dead drops. Paste anything. Set a price. Share a link. You keep 97%.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '48px' }}>
        <Link
          to="/create"
          style={{
            padding: '14px 32px',
            background: '#4a7fa5',
            color: '#f0ede6',
            fontWeight: 600,
            fontSize: '15px',
            borderRadius: '12px',
            textDecoration: 'none',
            transition: 'background 0.15s',
            display: 'inline-block',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#5a8fb5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#4a7fa5')}
        >
          Create a dead drop →
        </Link>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          marginBottom: '48px',
        }}
      >
        {[
          ['97%', 'to you, every time'],
          ['Anonymous', 'no account required'],
          ['Instant', 'on-chain settlement'],
        ].map(([val, label]) => (
          <div
            key={val}
            style={{
              background: '#111114',
              border: '1px solid #1e1e26',
              borderRadius: '12px',
              padding: '20px 12px',
            }}
          >
            <div
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                fontSize: '20px',
                fontWeight: 700,
                color: '#c8a96e',
                marginBottom: '4px',
              }}
            >
              {val}
            </div>
            <div style={{ fontSize: '11px', color: '#525260', letterSpacing: '0.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: '11px', color: '#525260' }}>
        Powered by{' '}
        <a
          href="https://conk.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#7a6440', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c8a96e')}
          onMouseLeave={e => (e.currentTarget.style.color = '#7a6440')}
        >
          CONK
        </a>
      </div>
    </div>
  )
}

/**
 * Handles the Google OAuth return at any route.
 * Google always redirects to the bare origin (/), but the user may have
 * started login from /create or /d/:castId — we restore that path after.
 */
function ZkCallbackHandler() {
  const { setSession } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!window.location.hash.includes('id_token')) return
    handleZkLoginCallback()
      .then(session => {
        if (!session) return
        setSession(session)
        const returnTo = localStorage.getItem('zklogin_return_to') ?? '/create'
        localStorage.removeItem('zklogin_return_to')
        navigate(returnTo, { replace: true })
      })
      .catch(console.error)
  }, [])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ZkCallbackHandler />
      <div style={{ minHeight: '100vh', background: '#0c0c0e', color: '#f0ede6' }}>
        <Nav />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/d/:castId" element={<DropPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
