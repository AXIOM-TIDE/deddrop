/**
 * CreatePage — Creator flow (tradecraft redesign)
 *
 * Steps: compose → login → fund-wallet → setup-wallet → setup-identity → publishing → done → error
 */

import React, { useState, useEffect } from 'react'
import { Transaction } from '@mysten/sui/transactions'
import { Lock, DollarSign, Share2, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { useStore } from '../lib/store'
import { sealEncrypt, registerKey } from '../lib/seal'
import {
  buildSoundCast, buildOpenHarbor, buildLaunchVessel,
  findHarbor, findVessels, findVesselCap, findUsdcCoins, usdcToBase,
} from '../lib/conk'
import { signAndExecute } from '../lib/zkLogin'
import { ZKPROXY_URL, PROTOCOL_CAST_FEE } from '../sui/config'
import ZkLoginButton from '../components/ZkLoginButton'
import FundingScreen from '../components/FundingScreen'

type Step = 'compose' | 'login' | 'fund-wallet' | 'setup-wallet' | 'setup-identity' | 'publishing' | 'done' | 'error'

const DROP_EXPIRY_DAYS_DISPLAY = 7

// ── Shared style tokens ──────────────────────────────────────────────────────
const S = {
  surface:    '#111114',
  surfaceHi:  '#161619',
  border:     '#1e1e26',
  borderHi:   '#2c2c38',
  bg:         '#0c0c0e',
  textPri:    '#f0ede6',
  textSec:    '#9898a8',
  textMuted:  '#525260',
  amber:      '#c8a96e',
  amberDim:   '#7a6440',
  steel:      '#4a7fa5',
  steelDim:   '#2a4a62',
  green:      '#6abf85',
  red:        '#c84a4a',
  mono:       "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" as const,
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: S.textMuted, marginBottom: '6px' }}>
      {children}
    </div>
  )
}

function StatusCard({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px', textAlign: 'center' }}>
      <div style={{ color: S.amber, width: '32px', height: '32px' }}>{icon}</div>
      <div>
        <div style={{ color: S.textPri, fontWeight: 600, fontSize: '17px' }} dangerouslySetInnerHTML={{ __html: title }} />
        <div style={{ color: S.textMuted, fontSize: '13px', marginTop: '4px' }}>{subtitle}</div>
      </div>
    </div>
  )
}

export default function CreatePage() {
  const { session, harborId, vesselId, vesselCapId, setHarborId, setVesselId, setVesselCapId, setPendingDrop } = useStore()

  const [content, setContent]           = useState('')
  const [hook, setHook]                 = useState('')
  const [priceDisplay, setPriceDisplay] = useState('1.00')
  const [step, setStep]                 = useState<Step>('compose')
  const [castId, setCastId]             = useState<string | null>(null)
  const [errorMsg, setErrorMsg]         = useState('')

  // Log wallet address once when session is available
  useEffect(() => {
    if (session?.address) console.log('[DEDDROP] zkLogin wallet:', session.address)
  }, [session?.address])

  async function handlePublish() {
    if (!content.trim() || !hook.trim()) return
    if (!session) { setStep('login'); return }

    try {
      let vessel    = vesselId    ?? (await findVessels(session.address))[0]   ?? null
      let vesselCap = vesselCapId ?? await findVesselCap(session.address)

      if (!vessel || !vesselCap) {
        let harbor = harborId ?? await findHarbor(session.address)

        if (!harbor) {
          setStep('setup-wallet')
          const usdcCoins   = await findUsdcCoins(session.address)
          const largestCoin = usdcCoins[0]
          if (!largestCoin || BigInt(largestCoin.balance) < 150_000n) {
            setStep('fund-wallet')
            return
          }
          const tx1 = new Transaction()
          tx1.setSender(session.address)
          const [harborCap] = buildOpenHarbor(tx1, largestCoin.coinObjectId)
          tx1.transferObjects([harborCap], tx1.pure.address(session.address))
          const r1 = await signAndExecute(tx1, session)
          if (r1.effects?.status?.status !== 'success') {
            throw new Error('Drop Wallet setup failed: ' + JSON.stringify(r1.effects?.status))
          }
          harbor = await findHarbor(session.address)
          if (harbor) setHarborId(harbor)
        }

        if (!harbor) throw new Error('Drop Wallet not found after setup. Please try again.')

        if (!vessel || !vesselCap) {
          setStep('setup-identity')
          const tx2 = new Transaction()
          tx2.setSender(session.address)
          const [cap] = buildLaunchVessel(tx2, harbor)
          tx2.transferObjects([cap], tx2.pure.address(session.address))
          const r2 = await signAndExecute(tx2, session)
          if (r2.effects?.status?.status !== 'success') {
            throw new Error('Identity setup failed: ' + JSON.stringify(r2.effects?.status))
          }
          vessel    = (await findVessels(session.address))[0] ?? null
          vesselCap = await findVesselCap(session.address)
        }
      }

      if (vessel)    setVesselId(vessel)
      if (vesselCap) setVesselCapId(vesselCap)

      if (!vessel || !vesselCap) throw new Error('Setup incomplete. Refresh and try again.')

      setStep('publishing')

      const usdcCoins = await findUsdcCoins(session.address)
      const payerCoin = usdcCoins[0]
      if (!payerCoin || BigInt(payerCoin.balance) < PROTOCOL_CAST_FEE) {
        throw new Error(
          `Not enough USDC. Publishing a drop costs $0.001. ` +
          `Your balance: $${(Number(payerCoin?.balance ?? 0) / 1e6).toFixed(4)}`
        )
      }

      const { ciphertext, keyHex, ivHex } = await sealEncrypt(content)

      const tx = new Transaction()
      tx.setSender(session.address)
      buildSoundCast(tx, {
        vesselId:    vessel,
        vesselCapId: vesselCap,
        hook:        hook.slice(0, 120),
        ciphertext,
        priceBase:   usdcToBase(priceDisplay),
        usdcCoinId:  payerCoin.coinObjectId,
      })

      const result = await signAndExecute(tx, session)
      if (result.effects?.status?.status !== 'success') {
        throw new Error('Cast sound TX failed: ' + JSON.stringify(result.effects?.status))
      }

      const soundEvent = result.events?.find(e =>
        (e.type as string)?.endsWith('::cast::CastSounded')
      )
      const newCastId = soundEvent?.parsedJson
        ? `0x${(soundEvent.parsedJson as any).cast_id?.replace(/^0x/, '')}`
        : null

      if (!newCastId) {
        const created = result.effects?.created ?? []
        const castObj = created.find(o => (o.owner as any)?.Shared !== undefined)
        if (!castObj?.reference?.objectId) throw new Error('Could not find Cast object ID in TX result')
        setCastId(castObj.reference.objectId)
      } else {
        setCastId(newCastId)
      }

      const finalCastId = newCastId ?? (() => {
        const created = result.effects?.created ?? []
        return created.find(o => (o.owner as any)?.Shared !== undefined)?.reference?.objectId
      })()

      if (!finalCastId) throw new Error('Could not resolve Cast ID from TX result')

      await registerKey(ZKPROXY_URL, finalCastId, keyHex, ivHex)

      setPendingDrop({
        hook,
        priceDisplay,
        ciphertext: Array.from(ciphertext),
        keyHex,
        ivHex,
      })

      setCastId(finalCastId)
      setStep('done')
    } catch (e: any) {
      console.error('[CreatePage]', e)
      setErrorMsg(e.message ?? 'Unknown error')
      setStep('error')
    }
  }

  const shareUrl = castId ? `${window.location.origin}/d/${castId}` : null

  return (
    <div style={{ maxWidth: '672px', margin: '0 auto', padding: '64px 16px' }}>

      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: S.textPri, marginBottom: '4px' }}>
          Create a dead drop
        </h1>
        <p style={{ color: S.textMuted, fontSize: '13px' }}>
          Paste your content. Set a price. Get a link. You keep 97%.
        </p>
      </div>

      {/* Compose / Login */}
      {(step === 'compose' || step === 'login') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Hook */}
          <div>
            <Label>Public preview <span style={{ color: S.textMuted, textTransform: 'none', letterSpacing: 0 }}>(what buyers see before paying)</span></Label>
            <input
              type="text"
              maxLength={120}
              value={hook}
              onChange={e => setHook(e.target.value)}
              placeholder="A system prompt that makes GPT-4 act as a senior quant…"
              style={{
                width: '100%',
                background: S.surface,
                border: `1px solid ${S.border}`,
                borderRadius: '8px',
                padding: '12px 16px',
                color: S.textPri,
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = S.amber)}
              onBlur={e => (e.target.style.borderColor = S.border)}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: S.textMuted, marginTop: '4px' }}>{hook.length}/120</div>
          </div>

          {/* Content */}
          <div>
            <Label>Content <span style={{ color: S.textMuted, textTransform: 'none', letterSpacing: 0 }}>(encrypted — only paying readers see this)</span></Label>
            <textarea
              rows={10}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste your prompt, research, alpha, or any text content here…"
              style={{
                width: '100%',
                background: S.surface,
                border: `1px solid ${S.border}`,
                borderRadius: '8px',
                padding: '12px 16px',
                color: S.textPri,
                fontSize: '13px',
                outline: 'none',
                resize: 'none',
                fontFamily: S.mono,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = S.amber)}
              onBlur={e => (e.target.style.borderColor = S.border)}
            />
          </div>

          {/* Price */}
          <div>
            <Label>Price per unlock (USDC)</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <DollarSign style={{ width: '16px', height: '16px', color: S.textMuted }} />
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={priceDisplay}
                onChange={e => setPriceDisplay(e.target.value)}
                style={{
                  background: S.surface,
                  border: `1px solid ${S.border}`,
                  borderRadius: '8px',
                  padding: '12px 16px',
                  color: S.textPri,
                  fontSize: '14px',
                  fontFamily: S.mono,
                  outline: 'none',
                  width: '120px',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = S.amber)}
                onBlur={e => (e.target.style.borderColor = S.border)}
              />
              <span style={{ color: S.textMuted, fontSize: '13px' }}>
                You receive{' '}
                <span style={{ fontFamily: S.mono, color: S.textSec }}>
                  ${(parseFloat(priceDisplay || '0') * 0.97).toFixed(4)}
                </span>{' '}
                per unlock (97%)
              </span>
            </div>
          </div>

          {/* Fee note */}
          <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: S.textSec }}>
            <span style={{ color: S.textPri }}>97% to you.</span> 3% protocol fee. Encrypted client-side before anything leaves your browser.
          </div>

          {/* First drop note */}
          {!harborId && (
            <div style={{ background: S.surface, border: `1px solid ${S.borderHi}`, borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: S.textMuted }}>
              <span style={{ color: S.textSec }}>First drop?</span>{' '}
              We'll provision your field account — a $0.15 USDC deposit that powers your drops.
              It's your balance on Sui, not a fee. Withdraw it anytime.
            </div>
          )}

          {/* CTA */}
          {session ? (
            <button
              onClick={handlePublish}
              disabled={!content.trim() || !hook.trim() || !priceDisplay}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                cursor: (content.trim() && hook.trim() && priceDisplay) ? 'pointer' : 'not-allowed',
                background: (content.trim() && hook.trim() && priceDisplay) ? S.steel : S.surface,
                color: (content.trim() && hook.trim() && priceDisplay) ? S.textPri : S.textMuted,
                fontWeight: 600,
                fontSize: '15px',
                transition: 'background 0.15s',
              }}
            >
              Encrypt &amp; Conceal
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ color: S.textMuted, fontSize: '13px', textAlign: 'center' }}>Authenticate to conceal your drop</p>
              <ZkLoginButton />
            </div>
          )}
        </div>
      )}

      {/* Fund wallet step */}
      {step === 'fund-wallet' && session && (
        <FundingScreen
          address={session.address}
          minBalance={150_000n}
          onFunded={handlePublish}
        />
      )}

      {step === 'setup-wallet' && (
        <StatusCard
          icon={<Loader2 style={{ width: '32px', height: '32px', animation: 'spin 1s linear infinite' }} />}
          title="Provisioning account…"
          subtitle="Depositing $0.15 USDC on-chain — your balance, not a fee. One-time only."
        />
      )}

      {step === 'setup-identity' && (
        <StatusCard
          icon={<Loader2 style={{ width: '32px', height: '32px', animation: 'spin 1s linear infinite' }} />}
          title="Initializing identity…"
          subtitle="One more transaction. This only happens once."
        />
      )}

      {step === 'publishing' && (
        <StatusCard
          icon={<Loader2 style={{ width: '32px', height: '32px', animation: 'spin 1s linear infinite' }} />}
          title="Encrypting &amp; publishing…"
          subtitle="Content encrypted in your browser, publishing on Sui."
        />
      )}

      {step === 'done' && shareUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: S.amber }}>
            <CheckCircle style={{ width: '22px', height: '22px' }} />
            <span style={{ fontSize: '18px', fontWeight: 700 }}>Dead drop active</span>
          </div>

          <div style={{ background: S.surface, border: `1px solid ${S.border}`, borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <Label>Transmission coordinates</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <code style={{ flex: 1, fontFamily: S.mono, fontSize: '13px', color: S.steel, wordBreak: 'break-all' }}>
                  {shareUrl}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  style={{
                    padding: '8px',
                    borderRadius: '8px',
                    background: S.surfaceHi,
                    border: `1px solid ${S.border}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <Share2 style={{ width: '14px', height: '14px', color: S.textSec }} />
                </button>
              </div>
            </div>

            <div>
              <Label>Cast ID</Label>
              <code style={{ fontFamily: S.mono, fontSize: '11px', color: S.textMuted, wordBreak: 'break-all' }}>
                {castId}
              </code>
            </div>

            <div style={{ fontSize: '13px', color: S.textSec }}>
              Paid window:{' '}
              <span style={{ color: S.textPri }}>{DROP_EXPIRY_DAYS_DISPLAY} days</span>
              {' '}at{' '}
              <span style={{ fontFamily: S.mono, color: S.textPri }}>${priceDisplay}</span>
              /unlock. Goes public (free to read) after that.
            </div>
          </div>

          <button
            onClick={() => { setStep('compose'); setContent(''); setHook(''); setCastId(null) }}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: `1px solid ${S.border}`,
              background: 'transparent',
              color: S.textSec,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = S.surface)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Create another dead drop
          </button>
        </div>
      )}

      {step === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: S.red }}>
            <AlertCircle style={{ width: '18px', height: '18px' }} />
            <span style={{ fontWeight: 600 }}>Transmission failed</span>
          </div>
          <div
            style={{
              background: S.surface,
              border: `1px solid ${S.red}`,
              borderRadius: '8px',
              padding: '12px 16px',
              color: S.red,
              fontSize: '13px',
              fontFamily: S.mono,
              wordBreak: 'break-all',
            }}
          >
            {errorMsg}
          </div>
          <button
            onClick={() => setStep('compose')}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: `1px solid ${S.border}`,
              background: 'transparent',
              color: S.textSec,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Try again
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
