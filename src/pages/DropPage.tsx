/**
 * DropPage — Buyer flow (tradecraft redesign)
 * Route: /d/:castId
 */

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Unlock, Loader2, AlertCircle, Eye, DollarSign } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { toB64 } from '@mysten/sui/utils'
import { useStore } from '../lib/store'
import { releaseKey, sealDecrypt } from '../lib/seal'
import { buildReadCast, fetchCast, findUsdcCoins, baseToUsdc, getSuiClient, CastInfo } from '../lib/conk'
import { signAndExecuteSponsored } from '../lib/zkLogin'
import { ZKPROXY_URL, PROTOCOL_READ_FEE } from '../sui/config'
import ZkLoginButton from '../components/ZkLoginButton'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

type Step = 'loading' | 'preview' | 'login' | 'unlocking' | 'unlocked' | 'error'

// ── Shared style tokens ──────────────────────────────────────────────────────
const S = {
  surface:   '#111114',
  surfaceHi: '#161619',
  border:    '#1e1e26',
  borderHi:  '#2c2c38',
  bg:        '#0c0c0e',
  textPri:   '#f0ede6',
  textSec:   '#9898a8',
  textMuted: '#525260',
  amber:     '#c8a96e',
  amberDim:  '#7a6440',
  steel:     '#4a7fa5',
  green:     '#6abf85',
  red:       '#c84a4a',
  mono:      "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" as const,
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: S.textMuted, marginBottom: '4px' }}>
      {children}
    </div>
  )
}

export default function DropPage() {
  const { castId } = useParams<{ castId: string }>()
  const { session } = useStore()

  const [cast, setCast]         = useState<CastInfo | null>(null)
  const [step, setStep]         = useState<Step>('loading')
  const [content, setContent]   = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!castId) return
    fetchCast(castId)
      .then(c => { setCast(c); setStep('preview') })
      .catch(e => { console.error('[DropPage] fetchCast failed:', e); setErrorMsg(e.message); setStep('error') })
  }, [castId])

  async function handleUnlock() {
    if (!cast || !session || !castId) return

    try {
      setStep('unlocking')

      // ── Check reader USDC (gas is sponsored — reader needs zero SUI) ──────
      const totalFee  = cast.priceBase + PROTOCOL_READ_FEE
      const usdcCoins = await findUsdcCoins(session.address)
      const payerCoin = usdcCoins.find(c => BigInt(c.balance) >= totalFee)

      if (!payerCoin) {
        const have = usdcCoins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
        throw new Error(
          `Not enough USDC. Need $${baseToUsdc(totalFee)}, ` +
          `you have $${baseToUsdc(have)}. ` +
          `Send USDC (Sui mainnet) to your wallet — no SUI needed, gas is covered.`
        )
      }

      // ── Build TX kind bytes (no gas — Enoki will add it) ───────────────
      const tx = new Transaction()
      tx.setSender(session.address)
      buildReadCast(tx, {
        castId,
        readerAddress: session.address,
        usdcCoinId:    payerCoin.coinObjectId,
        priceBase:     cast.priceBase,
      })

      const suiClient = getSuiClient()
      const kindBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true })

      // ── Sponsor gas via Enoki (reader pays USDC, DEDDROP covers SUI gas) ─
      const sponsorResp = await fetch(`${ZKPROXY_URL}/enoki-sponsor`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-App': 'deddrop' },
        body:    JSON.stringify({ txKindBytes: toB64(kindBytes), sender: session.address }),
      })

      if (!sponsorResp.ok) {
        const errText = await sponsorResp.text()
        throw new Error('Gas sponsorship failed — try again or contact support. ' + errText)
      }

      const { sponsoredBytes, sponsorSig } = await sponsorResp.json()

      // ── Sign with zkLogin + submit both signatures ─────────────────────
      const result = await signAndExecuteSponsored(sponsoredBytes, sponsorSig, session)
      if (result.effects?.status?.status !== 'success') {
        throw new Error('Read TX failed: ' + JSON.stringify(result.effects?.status))
      }

      const txDigest = result.digest
      if (!txDigest) throw new Error('No TX digest returned')

      const { keyHex, ivHex } = await releaseKey(ZKPROXY_URL, castId, txDigest, session.address)

      if (!cast.contentBytes || cast.contentBytes.length === 0) {
        throw new Error('Cast has no content to decrypt')
      }
      const plaintext = await sealDecrypt(cast.contentBytes, keyHex, ivHex)
      setContent(plaintext)
      setStep('unlocked')
    } catch (e: any) {
      console.error('[DropPage] handleUnlock failed:', e)
      setErrorMsg(e.message ?? 'Unknown error')
      setStep('error')
    }
  }

  if (!castId) return <ErrorView msg="Invalid drop link" />
  if (step === 'loading') return <SpinnerView />
  if (step === 'error') return (
    <ErrorView
      msg={errorMsg}
      onRetry={() => { setErrorMsg(''); setStep(cast ? 'preview' : 'loading') }}
    />
  )

  const totalCostBase    = (cast?.priceBase ?? 0n) + PROTOCOL_READ_FEE
  const totalCostDisplay = baseToUsdc(totalCostBase)

  return (
    <div style={{ maxWidth: '672px', margin: '0 auto', padding: '64px 16px' }}>

      {/* Cast preview */}
      {cast && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
            <Eye style={{ width: '18px', height: '18px', color: S.textMuted, marginTop: '2px', flexShrink: 0 }} />
            <p style={{ color: S.textPri, fontSize: '18px', lineHeight: 1.5, margin: 0 }}>
              {cast.hook}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '13px', color: S.textMuted }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: S.mono }}>
              <DollarSign style={{ width: '12px', height: '12px' }} />
              {baseToUsdc(cast.priceBase)} USDC
            </span>
            {cast.isExpired ? (
              <span
                style={{
                  fontSize: '10px',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: S.green,
                  border: `1px solid ${S.green}`,
                  borderRadius: '4px',
                  padding: '2px 8px',
                }}
              >
                Declassified
              </span>
            ) : (
              <span>Expires {dayjs(Number(cast.expiryTimestamp)).fromNow()}</span>
            )}
          </div>
        </div>
      )}

      {/* Unlock flow */}
      {step === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {cast?.isExpired ? (
            <div style={{ background: '#0d1a11', border: `1px solid ${S.green}`, borderRadius: '12px', padding: '16px 20px', fontSize: '13px', color: S.green }}>
              This drop's paid window has closed — it's now free to read.
            </div>
          ) : (
            <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '12px', padding: '16px 20px', fontSize: '13px', color: S.textSec }}>
              Cost to decrypt:{' '}
              <span style={{ color: S.textPri, fontWeight: 600, fontFamily: S.mono }}>${totalCostDisplay} USDC</span>
              <span style={{ color: S.textMuted, marginLeft: '8px' }}>
                (${baseToUsdc(cast?.priceBase ?? 0n)} to creator + $0.001 network fee)
              </span>
            </div>
          )}

          {session ? (
            <button
              onClick={handleUnlock}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                background: S.steel,
                color: S.textPri,
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#5a8fb5')}
              onMouseLeave={e => (e.currentTarget.style.background = S.steel)}
            >
              <Unlock style={{ width: '16px', height: '16px' }} />
              {cast?.isExpired ? 'Read for free' : `Decrypt — $${totalCostDisplay}`}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ color: S.textMuted, fontSize: '13px', textAlign: 'center' }}>Authenticate to decrypt</p>
              <ZkLoginButton />
            </div>
          )}

          <p style={{ textAlign: 'center', fontSize: '11px', color: S.textMuted }}>
            Encrypted client-side. Settled on-chain. Creator keeps 97%.{' '}
            Powered by{' '}
            <a
              href="https://conk.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: S.amberDim, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = S.amber)}
              onMouseLeave={e => (e.currentTarget.style.color = S.amberDim)}
            >
              CONK
            </a>.
          </p>
        </div>
      )}

      {step === 'unlocking' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 0', gap: '16px', textAlign: 'center' }}>
          <Loader2 style={{ width: '32px', height: '32px', color: S.amber, animation: 'spin 1s linear infinite' }} />
          <div>
            <div style={{ color: S.textPri, fontWeight: 600 }}>Verifying payment…</div>
            <div style={{ color: S.textMuted, fontSize: '13px', marginTop: '4px' }}>Confirming on-chain, retrieving your access key</div>
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {step === 'unlocked' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: S.amber, marginBottom: '8px' }}>
            <Unlock style={{ width: '18px', height: '18px' }} />
            <span style={{ fontWeight: 700, fontSize: '17px' }}>Decrypted</span>
          </div>
          <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '12px', padding: '24px' }}>
            <pre style={{ color: S.textSec, fontSize: '13px', whiteSpace: 'pre-wrap', fontFamily: S.mono, lineHeight: 1.6, margin: 0 }}>
              {content}
            </pre>
          </div>
          <p style={{ fontSize: '11px', color: S.textMuted, textAlign: 'center' }}>
            Decrypted in your browser. Never transmitted through any server.
          </p>
        </div>
      )}
    </div>
  )
}

function SpinnerView() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '128px 0' }}>
      <Loader2 style={{ width: '32px', height: '32px', color: '#c8a96e', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ErrorView({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '80px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
      <AlertCircle style={{ width: '32px', height: '32px', color: '#c84a4a' }} />
      <div style={{ color: '#f0ede6', fontWeight: 600 }}>Transmission failed</div>
      <div style={{ color: '#525260', fontSize: '13px', fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace", wordBreak: 'break-all' }}>{msg}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: '8px',
            padding: '10px 24px',
            borderRadius: '8px',
            border: '1px solid #1e1e26',
            background: 'transparent',
            color: '#9898a8',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Try again
        </button>
      )}
    </div>
  )
}
