/**
 * FundingScreen — wallet provisioning UX for DEDDROP
 * Shows address (QR + copy), polls USDC balance, unlocks "Create Drop" once funded.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Copy, CheckCircle } from 'lucide-react'
import { findUsdcCoins, baseToUsdc } from '../lib/conk'

interface Props {
  address: string
  minBalance: bigint
  onFunded: () => void
}

export default function FundingScreen({ address, minBalance, onFunded }: Props) {
  const [balance, setBalance] = useState<bigint>(0n)
  const [copied, setCopied]   = useState(false)
  const loggedRef             = useRef(false)

  // Log address once on mount
  useEffect(() => {
    if (!loggedRef.current) {
      console.log('[DEDDROP] zkLogin wallet address:', address)
      loggedRef.current = true
    }
  }, [address])

  // Poll USDC balance every 5s
  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const coins = await findUsdcCoins(address)
        if (cancelled) return
        const total = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
        setBalance(total)
      } catch (e) {
        console.error('[FundingScreen] balance poll error', e)
      }
    }

    poll()
    const id = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [address])

  function handleCopy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const funded = balance >= minBalance
  const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=c8a96e&bgcolor=111114&data=${encodeURIComponent(address)}&format=png&margin=5`

  return (
    <div
      style={{
        background: '#111114',
        border: '1px solid #1e1e26',
        borderRadius: '16px',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '28px',
      }}
    >
      {/* Header */}
      <div>
        <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '6px' }}>
          Account Provisioning
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f0ede6', margin: 0 }}>
          Fund Your Field Account
        </h2>
      </div>

      {/* Mission briefing */}
      <div style={{ background: '#0c0c0e', border: '1px solid #1e1e26', borderRadius: '8px', padding: '16px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '8px' }}>
          Mission Briefing
        </div>
        <p style={{ color: '#9898a8', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
          Provision your account — transmit USDC on Sui mainnet to the coordinates below.
          Minimum $0.15. Your balance, withdrawable anytime. Not a fee.
        </p>
        <div style={{ marginTop: '12px', display: 'flex', gap: '24px' }}>
          <div>
            <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260' }}>Network</div>
            <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace", fontSize: '12px', color: '#f0ede6', marginTop: '2px' }}>Sui mainnet</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260' }}>Asset</div>
            <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace", fontSize: '12px', color: '#f0ede6', marginTop: '2px' }}>USDC only</div>
          </div>
        </div>
      </div>

      {/* QR + Address */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* QR code */}
        <div style={{ flexShrink: 0 }}>
          <img
            src={qrUrl}
            alt="Wallet QR"
            width={120}
            height={120}
            style={{ border: '1px solid #1e1e26', borderRadius: '8px', display: 'block' }}
          />
        </div>

        {/* Address block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '6px' }}>
            Transmission Coordinates
          </div>
          <div
            style={{
              background: '#0c0c0e',
              border: '1px solid #1e1e26',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}
          >
            <code
              style={{
                flex: 1,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                fontSize: '11px',
                color: '#c8a96e',
                wordBreak: 'break-all',
                lineHeight: 1.5,
              }}
            >
              {address}
            </code>
            <button
              onClick={handleCopy}
              title="Copy address"
              style={{
                flexShrink: 0,
                background: copied ? '#1e2e1e' : '#161619',
                border: '1px solid ' + (copied ? '#6abf85' : '#2c2c38'),
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 0.15s',
              }}
            >
              {copied
                ? <CheckCircle style={{ width: '14px', height: '14px', color: '#6abf85' }} />
                : <Copy style={{ width: '14px', height: '14px', color: '#9898a8' }} />
              }
            </button>
          </div>
        </div>
      </div>

      {/* Balance + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '4px' }}>
            Live Balance
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              fontSize: '22px',
              fontWeight: 600,
              color: funded ? '#6abf85' : '#f0ede6',
            }}
          >
            ${baseToUsdc(balance)} <span style={{ fontSize: '12px', color: '#525260' }}>USDC</span>
          </div>
        </div>

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: funded ? '#6abf85' : '#c8a96e',
              boxShadow: funded ? '0 0 6px #6abf85' : '0 0 6px #c8a96e',
              animation: funded ? 'none' : 'pulse 2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: funded ? '#6abf85' : '#c8a96e',
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            }}
          >
            {funded ? 'FUNDED' : 'AWAITING TRANSFER'}
          </span>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onFunded}
        disabled={!funded}
        style={{
          width: '100%',
          padding: '16px',
          borderRadius: '12px',
          border: 'none',
          cursor: funded ? 'pointer' : 'not-allowed',
          background: funded ? '#4a7fa5' : '#1e1e26',
          color: funded ? '#f0ede6' : '#525260',
          fontWeight: 600,
          fontSize: '15px',
          letterSpacing: '0.02em',
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        Create Drop →
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
