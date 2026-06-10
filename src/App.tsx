import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import CreatePage from './pages/CreatePage'
import DropPage from './pages/DropPage'
import { useStore } from './lib/store'

function Nav() {
  const { session } = useStore()
  const loc = useLocation()

  return (
    <nav className="border-b border-zinc-800 px-4 py-4">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-white font-bold">
          <Lock className="w-4 h-4 text-cyan-400" />
          CONK Drop
        </Link>
        <div className="flex items-center gap-4">
          {loc.pathname !== '/' && (
            <Link to="/" className="text-sm text-zinc-400 hover:text-white transition">
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
        <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-full px-4 py-1.5 text-sm text-zinc-400 mb-6">
          <Lock className="w-3.5 h-3.5 text-cyan-400" />
          Encrypted on Sui. You keep 97%.
        </div>
        <h1 className="text-4xl font-bold text-white leading-tight mb-4">
          Charge for anything.<br />Keep almost everything.
        </h1>
        <p className="text-zinc-400 text-lg max-w-lg mx-auto">
          Paste your prompt, research, or alpha. Set a USDC price.
          Share a link. Buyers pay on-chain. You earn instantly.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          to="/create"
          className="px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold rounded-xl transition"
        >
          Create a drop →
        </Link>
        <a
          href="https://conk.app"
          target="_blank"
          rel="noopener noreferrer"
          className="px-8 py-4 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-xl transition"
        >
          What is CONK?
        </a>
      </div>

      <div className="grid grid-cols-3 gap-6 text-center pt-4">
        {[
          ['97%', 'goes to the creator'],
          ['AES-256-GCM', 'client-side encryption'],
          ['Sui', 'sub-second settlement'],
        ].map(([val, label]) => (
          <div key={val}>
            <div className="text-xl font-bold text-white">{val}</div>
            <div className="text-xs text-zinc-500 mt-1">{label}</div>
          </div>
        ))}
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
