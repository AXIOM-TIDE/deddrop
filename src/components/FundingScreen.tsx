/**
 * FundingScreen — wallet provisioning UX for DEDDROP
 *
 * Shows address (QR + copy), polls both USDC and SUI balances live,
 * and unlocks "Create Drop" only when BOTH requirements are met.
 *
 * Gas reality: harbor::open ~0.002 SUI, vessel::launch ~0.003 SUI,
 * cast::sound ~0.003 SUI. Gate at 0.05 SUI for comfortable margin.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Copy, CheckCircle, RefreshCw } from 'lucide-react'
import { findUsdcCoins, baseToUsdc, getSuiClient } from '../lib/conk'

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SUI_MIST = 50_000_000n  // 0.05 SUI — covers setup + sound + margin

const USDC_COIN_TYPE_SHORT = '0xdba34672...::usdc::USDC'
const USDC_COIN_TYPE_FULL  = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSui(mist: bigint): string {
  return (Number(mist) / 1e9).toFixed(4)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  address:    string
  minBalance: bigint   // min USDC in base units (150_000n = $0.15)
  onFunded:   () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FundingScreen({ address, minBalance, onFunded }: Props) {
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n)
  const [suiBalance,  setSuiBalance]  = useState<bigint>(0n)
  const [polling,     setPolling]     = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [coinTypeFull, setCoinTypeFull] = useState(false)
  const loggedRef = useRef(false)

  // Log address once on mount
  useEffect(() => {
    if (!loggedRef.current) {
      console.log('[DEDDROP] zkLogin wallet address:', address)
      loggedRef.current = true
    }
  }, [address])

  const poll = useCallback(async () => {
    setPolling(true)
    try {
      const [coins, suiData] = await Promise.all([
        findUsdcCoins(address),
        getSuiClient().getBalance({ owner: address }),
      ])
      const usdcTotal = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
      setUsdcBalance(usdcTotal)
      setSuiBalance(BigInt(suiData.totalBalance))
    } catch (e) {
      console.error('[FundingScreen] balance poll error', e)
    } finally {
      setPolling(false)
    }
  }, [address])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [poll])

  function handleCopy() {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const usdcOk = usdcBalance >= minBalance
  const suiOk  = suiBalance  >= MIN_SUI_MIST
  const funded  = usdcOk && suiOk

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&color=c8a96e&bgcolor=111114&data=${encodeURIComponent(address)}&format=png&margin=5`

  return (
    <div style={{
      background: '#111114',
      border: '1px solid #1e1e26',
      borderRadius: '16px',
      padding: '32px',
      display: 'flex',
      flexDirection: 'column',
      gap: '28px',
    }}>

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
        <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '10px' }}>
          Mission Briefing
        </div>
        <p style={{ color: '#9898a8', fontSize: '13px', lineHeight: 1.65, margin: '0 0 12px 0' }}>
          To create dead drops you need{' '}
          <span style={{ color: '#f0ede6' }}>two things</span>{' '}
          in your wallet on{' '}
          <span style={{ color: '#f0ede6' }}>Sui mainnet</span>:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Requirement
            label="USDC"
            detail="your on-chain balance — powers the drop wallet. Not a fee."
            needed="$0.15 min"
          />
          <Requirement
            label="SUI"
            detail="network gas for transactions (harbor setup + publishing). Your money — unused gas is refunded."
            needed="~0.05 SUI"
          />
        </div>
        <p style={{ color: '#525260', fontSize: '12px', margin: '12px 0 0 0', lineHeight: 1.5 }}>
          Send both to the coordinates below.{' '}
          <span style={{ color: '#9898a8' }}>Network: Sui mainnet.</span>
        </p>
      </div>

      {/* QR + Address */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div style={{ flexShrink: 0 }}>
          <img
            src={qrUrl}
            alt="Wallet QR"
            width={120}
            height={120}
            style={{ border: '1px solid #1e1e26', borderRadius: '8px', display: 'block' }}
          />
          <div style={{ fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#525260', textAlign: 'center', marginTop: '6px' }}>
            Scan to send
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260', marginBottom: '6px' }}>
            Transmission Coordinates
          </div>
          <div style={{
            background: '#0c0c0e',
            border: '1px solid #1e1e26',
            borderRadius: '8px',
            padding: '12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}>
            <code style={{
              flex: 1,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              fontSize: '11px',
              color: '#c8a96e',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
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

      {/* Live balance dashboard */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#525260' }}>
            Live Balance
          </div>
          <button
            onClick={poll}
            disabled={polling}
            title="Refresh"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#525260', padding: '2px', display: 'flex' }}
          >
            <RefreshCw style={{ width: '11px', height: '11px', animation: polling ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        <div style={{
          background: '#0c0c0e',
          border: '1px solid #1e1e26',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          {/* USDC row */}
          <BalanceRow
            asset="USDC"
            assetSub="Sui mainnet"
            value={`$${baseToUsdc(usdcBalance)}`}
            needed={`need $${baseToUsdc(minBalance)} min`}
            ok={usdcOk}
          />
          <div style={{ height: '1px', background: '#1e1e26' }} />
          {/* SUI row */}
          <BalanceRow
            asset="SUI"
            assetSub="gas"
            value={`${formatSui(suiBalance)}`}
            needed="need 0.05 min"
            ok={suiOk}
          />
        </div>

        {/* USDC coin type note */}
        <div style={{ marginTop: '10px', fontSize: '11px', color: '#525260', lineHeight: 1.5 }}>
          <span style={{ color: '#7a6440' }}>USDC coin type: </span>
          <code
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              fontSize: '10px',
              color: '#7a6440',
              cursor: 'pointer',
            }}
            title={USDC_COIN_TYPE_FULL}
            onClick={() => setCoinTypeFull(v => !v)}
          >
            {coinTypeFull ? USDC_COIN_TYPE_FULL : USDC_COIN_TYPE_SHORT}
          </code>
          <span style={{ color: '#525260' }}> — native Sui USDC only. Not bridged/Base/Ethereum USDC.</span>
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
        {funded
          ? 'Create Drop →'
          : !usdcOk && !suiOk
            ? 'Send USDC + SUI to activate'
            : !usdcOk
              ? 'Send USDC to activate'
              : 'Send SUI for gas to activate'}
      </button>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
      `}</style>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Requirement({ label, detail, needed }: { label: string; detail: string; needed: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0,
        marginTop: '1px',
        background: '#1e1e26',
        border: '1px solid #2c2c38',
        borderRadius: '4px',
        padding: '2px 6px',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        fontSize: '10px',
        color: '#c8a96e',
        letterSpacing: '0.05em',
      }}>
        {label}
      </div>
      <div style={{ fontSize: '12px', color: '#9898a8', lineHeight: 1.5 }}>
        <span style={{ color: '#c8a96e', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>{needed}</span>
        {' — '}
        {detail}
      </div>
    </div>
  )
}

function BalanceRow({
  asset, assetSub, value, needed, ok,
}: {
  asset: string; assetSub: string; value: string; needed: string; ok: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
          fontSize: '12px',
          color: '#f0ede6',
          fontWeight: 600,
        }}>
          {asset}
        </span>
        <span style={{ fontSize: '10px', color: '#525260' }}>{assetSub}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
          fontSize: '14px',
          color: ok ? '#6abf85' : '#f0ede6',
          fontWeight: 600,
        }}>
          {value}
        </span>
        <span style={{ fontSize: '10px', color: '#525260', minWidth: '80px', textAlign: 'right' }}>
          {needed}
        </span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          minWidth: '72px',
          justifyContent: 'flex-end',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: ok ? '#6abf85' : '#c8a96e',
            boxShadow: ok ? '0 0 5px #6abf85' : '0 0 5px #c8a96e',
            animation: ok ? 'none' : 'pulse 2s ease-in-out infinite',
          }} />
          <span style={{
            fontSize: '9px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            color: ok ? '#6abf85' : '#c8a96e',
          }}>
            {ok ? 'OK' : 'LOW'}
          </span>
        </div>
      </div>
    </div>
  )
}
