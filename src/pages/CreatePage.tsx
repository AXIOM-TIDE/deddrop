/**
 * CreatePage — Creator flow
 *
 * Step 1: Enter content + set price
 * Step 2: zkLogin (if not already signed in)
 * Step 3: Ensure Vessel + VesselCap exist (one-time setup)
 * Step 4: Encrypt → sound Cast (v13 API) → register SEAL key → show share link
 */

import React, { useState } from 'react'
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
import clsx from 'clsx'

type Step = 'compose' | 'login' | 'setup-wallet' | 'setup-identity' | 'publishing' | 'done' | 'error'

export default function CreatePage() {
  const { session, harborId, vesselId, vesselCapId, setHarborId, setVesselId, setVesselCapId, setPendingDrop } = useStore()

  const [content, setContent]           = useState('')
  const [hook, setHook]                 = useState('')
  const [priceDisplay, setPriceDisplay] = useState('1.00')
  const [step, setStep]                 = useState<Step>('compose')
  const [castId, setCastId]             = useState<string | null>(null)
  const [errorMsg, setErrorMsg]         = useState('')

  async function handlePublish() {
    if (!content.trim() || !hook.trim()) return
    if (!session) { setStep('login'); return }

    try {
      // ── Resolve on-chain identity (one-time setup if missing) ───────────────
      let vessel    = vesselId    ?? (await findVessels(session.address))[0]   ?? null
      let vesselCap = vesselCapId ?? await findVesselCap(session.address)

      if (!vessel || !vesselCap) {
        // Two TXs: Drop Wallet first, then publishing identity.
        // (harbor::open transfers the object; can't chain into vessel::launch in one PTB)
        let harbor = harborId ?? await findHarbor(session.address)

        if (!harbor) {
          // TX 1: Fund Drop Wallet ($0.15 USDC — user's balance, not a fee)
          setStep('setup-wallet')
          const usdcCoins = await findUsdcCoins(session.address)
          const largestCoin = usdcCoins[0]
          if (!largestCoin || BigInt(largestCoin.balance) < 150_000n) {
            throw new Error(
              'Your Drop Wallet needs $0.15 USDC to get started. ' +
              "That's your balance on-chain — not a fee. " +
              'Add USDC to your Sui wallet and try again.'
            )
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
          if (harbor) { setHarborId(harbor) }
        }

        if (!harbor) throw new Error('Drop Wallet not found after setup. Please try again.')

        if (!vessel || !vesselCap) {
          // TX 2: Create publishing identity (free, one-time)
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

      if (!vessel || !vesselCap) {
        throw new Error('Setup incomplete. Refresh and try again.')
      }

      setStep('publishing')

      // ── Find USDC coin for cast publication fee ─────────────────────────────
      const usdcCoins = await findUsdcCoins(session.address)
      const payerCoin = usdcCoins[0]
      if (!payerCoin || BigInt(payerCoin.balance) < PROTOCOL_CAST_FEE) {
        throw new Error(
          `Not enough USDC. Publishing a drop costs $0.001. ` +
          `Your balance: $${(Number(payerCoin?.balance ?? 0) / 1e6).toFixed(4)}`
        )
      }

      // ── Encrypt content ─────────────────────────────────────────────────────
      const { ciphertext, keyHex, ivHex } = await sealEncrypt(content)

      // ── Build + sign sound TX ──────────────────────────────────────────────
      const tx = new Transaction()
      tx.setSender(session.address)
      buildSoundCast(tx, {
        vesselId:   vessel,
        vesselCapId: vesselCap,
        hook:       hook.slice(0, 120),
        ciphertext,
        priceBase:  usdcToBase(priceDisplay),
        usdcCoinId: payerCoin.coinObjectId,
      })

      const result = await signAndExecute(tx, session)
      if (result.effects?.status?.status !== 'success') {
        throw new Error('Cast sound TX failed: ' + JSON.stringify(result.effects?.status))
      }

      // ── Extract castId from CastSounded event ──────────────────────────────
      const soundEvent = result.events?.find(e =>
        (e.type as string)?.endsWith('::cast::CastSounded')
      )
      const newCastId = soundEvent?.parsedJson
        ? `0x${(soundEvent.parsedJson as any).cast_id?.replace(/^0x/, '')}`
        : null

      if (!newCastId) {
        // Fallback: find shared Cast object in created objects
        const created = result.effects?.created ?? []
        const castObj = created.find(o => (o.owner as any)?.Shared !== undefined)
        if (!castObj?.reference?.objectId) {
          throw new Error('Could not find Cast object ID in TX result')
        }
        setCastId(castObj.reference.objectId)
      } else {
        setCastId(newCastId)
      }

      const finalCastId = newCastId ?? (() => {
        const created = result.effects?.created ?? []
        return created.find(o => (o.owner as any)?.Shared !== undefined)?.reference?.objectId
      })()

      if (!finalCastId) throw new Error('Could not resolve Cast ID from TX result')

      // ── Register SEAL key with zkProxy ─────────────────────────────────────
      await registerKey(ZKPROXY_URL, finalCastId, keyHex, ivHex)

      // ── Persist pending drop (survives refresh before link is copied) ──────
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
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-white mb-1">Create a drop</h1>
        <p className="text-zinc-400 text-sm">
          Paste your content. Set a price. Get a link. You keep 97%.
        </p>
      </div>

      {(step === 'compose' || step === 'login') && (
        <div className="space-y-6">
          {/* Hook */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Public preview <span className="text-zinc-500">(what buyers see before paying)</span>
            </label>
            <input
              type="text"
              maxLength={120}
              value={hook}
              onChange={e => setHook(e.target.value)}
              placeholder="A system prompt that makes GPT-4 act as a senior quant…"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500 transition"
            />
            <div className="text-right text-xs text-zinc-600 mt-1">{hook.length}/120</div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Content <span className="text-zinc-500">(encrypted — only paying readers see this)</span>
            </label>
            <textarea
              rows={10}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste your prompt, research, alpha, or any text content here…"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500 transition font-mono text-sm resize-none"
            />
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Price per unlock (USDC)
            </label>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-zinc-500" />
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={priceDisplay}
                onChange={e => setPriceDisplay(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition w-32"
              />
              <span className="text-zinc-500 text-sm">
                You receive ${(parseFloat(priceDisplay || '0') * 0.97).toFixed(4)} per unlock (97%)
              </span>
            </div>
          </div>

          {/* Fee note */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-400">
            <span className="text-zinc-300">97% to you.</span> 3% protocol fee. Encrypted client-side before anything leaves your browser.
          </div>

          {/* Drop Wallet note (first-time setup) */}
          {!harborId && (
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-500">
              <span className="text-zinc-300">First drop?</span>{' '}
              We’ll load your Drop Wallet — a $0.15 USDC deposit that powers your drops.
              It’s your balance on Sui, not a fee. Withdraw it anytime.
            </div>
          )}

          {/* CTA */}
          {session ? (
            <button
              onClick={handlePublish}
              disabled={!content.trim() || !hook.trim() || !priceDisplay}
              className={clsx(
                'w-full py-4 rounded-xl font-semibold text-base transition',
                content.trim() && hook.trim() && priceDisplay
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-black'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              )}
            >
              Encrypt &amp; Publish
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-zinc-500 text-sm text-center">Sign in with Google to publish your drop</p>
              <ZkLoginButton />
            </div>
          )}
        </div>
      )}

      {step === 'setup-wallet' && (
        <StatusCard
          icon={<Loader2 className="animate-spin" />}
          title="Loading your Drop Wallet…"
          subtitle="Depositing $0.15 USDC on-chain — your balance, not a fee. One-time only."
        />
      )}

      {step === 'setup-identity' && (
        <StatusCard
          icon={<Loader2 className="animate-spin" />}
          title="Finishing setup…"
          subtitle="One more transaction. This only happens once."
        />
      )}

      {step === 'publishing' && (
        <StatusCard
          icon={<Loader2 className="animate-spin" />}
          title="Encrypting &amp; publishing…"
          subtitle="Content encrypted in your browser, publishing on Sui."
        />
      )}

      {step === 'done' && shareUrl && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-green-400">
            <CheckCircle className="w-6 h-6" />
            <span className="text-lg font-semibold">Drop is live</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-4">
            <div>
              <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">Share link</div>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-cyan-400 text-sm break-all">{shareUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition"
                >
                  <Share2 className="w-4 h-4 text-zinc-300" />
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">Drop ID</div>
              <code className="text-zinc-400 text-xs break-all">{castId}</code>
            </div>
            <div className="text-sm text-zinc-400">
              Paid window: <span className="text-white">{DROP_EXPIRY_DAYS_DISPLAY} days</span> at ${priceDisplay}/unlock.
              Goes public (free to read) after that.
            </div>
          </div>
          <button
            onClick={() => { setStep('compose'); setContent(''); setHook(''); setCastId(null) }}
            className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            Create another drop
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold">Something went wrong</span>
          </div>
          <div className="bg-zinc-900 border border-red-900 rounded-lg px-4 py-3 text-red-300 text-sm font-mono break-all">
            {errorMsg}
          </div>
          <button
            onClick={() => setStep('compose')}
            className="w-full py-3 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

const DROP_EXPIRY_DAYS_DISPLAY = 7  // matches DUR_7D

function StatusCard({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="text-cyan-400 w-8 h-8">{icon}</div>
      <div>
        <div className="text-white font-semibold text-lg" dangerouslySetInnerHTML={{ __html: title }} />
        <div className="text-zinc-500 text-sm mt-1">{subtitle}</div>
      </div>
    </div>
  )
}
