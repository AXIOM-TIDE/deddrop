import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import CreatePage from './pages/CreatePage'
import DropPage from './pages/DropPage'
import { useStore } from './lib/store'

function Nav() {
  const { session } = useStore()
  const loc = useLocation()

  return (
    <nav className="border-b border-zinc-800 px-4 py-4">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <Link to="/" className="text-white font-bold tracking-tight text-lg">
          DEDDROP
        </Link>
        <div className="flex items-center gap-4">
          {loc.pathname !== '/' && (
            <Link to="/create" className="text-sm text-zinc-400 hover:text-white transition">
              Create a drop
            </Link>
          )}
          {session && (
            <span className="text-xs text-zinc-600 font-mono">
              {session.address.slice(0, 6)}…{session.address.slice(-4)}
            </span>
          )}
        </div>
      </div>
    </nav>
  )
}

function Landing() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-8">
      <div>
        <h1 className="text-5xl font-bold text-white leading-tight mb-4 tracking-tight">
          Lock it. Link it.<br />Get paid.
        </h1>
        <p className="text-zinc-400 text-lg max-w-md mx-auto">
          Anonymous paid drops. Paste anything. Set a price.
          Share a link. You keep 97%.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          to="/create"
          className="px-8 py-4 bg-white hover:bg-zinc-100 text-black font-semibold rounded-xl transition"
        >
          Create a drop →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6 text-center pt-4">
        {[
          ['97%', 'to you, every time'],
          ['Anonymous', 'no account required'],
          ['Instant', 'on-chain settlement'],
        ].map(([val, label]) => (
          <div key={val}>
            <div className="text-xl font-bold text-white">{val}</div>
            <div className="text-xs text-zinc-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="pt-8 text-xs text-zinc-700">
        Powered by{' '}
        <a href="https://conk.app" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-500 transition">
          CONK
        </a>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-black text-white">
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
