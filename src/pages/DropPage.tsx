/**
 * DropPage — Buyer flow
 * Route: /d/:castId
 *
 * Step 1: Fetch Cast metadata → show hook + price
 * Step 2: zkLogin (if not signed in) — return_to saves /d/:castId
 * Step 3: Find reader's USDC coins (NO Harbor needed in v13)
 * Step 4: Execute cast::read() TX — fee splits: author 97%, Abyss 3%+flat
 * Step 5: POST /cast-decrypt to zkProxy → get key+iv → decrypt content
 *
 * ⚠️  COLD-START CAVEAT: Agents have pre-funded USDC. A real human with an
 * empty wallet will hit "Insufficient USDC" at Step 3 with no in-app funding
 * flow. The "fund your wallet" UX is NOT yet built. Flag this when testing.
 */

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Unlock, Loader2, AlertCircle, Eye, DollarSign } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { useStore } from '../lib/store'
import { releaseKey, sealDecrypt } from '../lib/seal'
import { buildReadCast, fetchCast, findUsdcCoins, baseToUsdc, CastInfo } from '../lib/conk'
import { signAndExecute } from '../lib/zkLogin'
import { ZKPROXY_URL, PROTOCOL_READ_FEE } from '../sui/config'
import ZkLoginButton from '../components/ZkLoginButton'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

type Step = 'loading' | 'preview' | 'login' | 'unlocking' | 'unlocked' | 'error'

export default function DropPage() {
  const { castId } = useParams<{ castId: string }>()
  const { session } = useStore()

  const [cast, setCast]       = useState<CastInfo | null>(null)
  const [step, setStep]       = useState<Step>('loading')
  const [content, setContent] = useState('')
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

      // ── Find reader's USDC coins (v13: no Harbor needed) ──────────────────
      const totalFee = cast.priceBase + PROTOCOL_READ_FEE
      const usdcCoins = await findUsdcCoins(session.address)
      const payerCoin = usdcCoins.find(c => BigInt(c.balance) >= totalFee)

      if (!payerCoin) {
        // ⚠️ COLD-START: Real human buyers hit this wall — no in-app funding yet
        throw new Error(
          `Not enough USDC to unlock. Need $${baseToUsdc(totalFee)}, ` +
          `you have $${baseToUsdc(usdcCoins.reduce((sum, c) => sum + BigInt(c.balance), 0n))}. ` +
          `Add USDC to your Sui wallet and try again.`
        )
      }

      // ── Build + sign read TX ───────────────────────────────────────────────
      const tx = new Transaction()
      tx.setSender(session.address)
      buildReadCast(tx, {
        castId,
        readerAddress: session.address,
        usdcCoinId:    payerCoin.coinObjectId,
        priceBase:     cast.priceBase,
      })

      const result = await signAndExecute(tx, session)
      if (result.effects?.status?.status !== 'success') {
        throw new Error('Read TX failed: ' + JSON.stringify(result.effects?.status))
      }

      const txDigest = result.digest
      if (!txDigest) throw new Error('No TX digest returned')

      // ── Fetch decryption key from zkProxy ──────────────────────────────────
      const { keyHex, ivHex } = await releaseKey(ZKPROXY_URL, castId, txDigest, session.address)

      // ── Decrypt content ─────────────────────────────────────────────────────
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
  if (step === 'error')   return <ErrorView msg={errorMsg} onRetry={() => { setErrorMsg(''); setStep(cast ? 'preview' : 'loading') }} />

  const totalCostBase    = (cast?.priceBase ?? 0n) + PROTOCOL_READ_FEE
  const totalCostDisplay = baseToUsdc(totalCostBase)

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      {/* Cast preview */}
      {cast && (
        <div className="mb-8">
          <div className="flex items-start gap-3 mb-4">
            <Eye className="w-5 h-5 text-zinc-500 mt-0.5 shrink-0" />
            <p className="text-white text-lg leading-relaxed">{cast.hook}</p>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span className="flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" />
              {baseToUsdc(cast.priceBase)} USDC to unlock
            </span>
            {cast.isExpired ? (
              <span className="text-green-400">Free (post-expiry)</span>
            ) : (
              <span>Expires {dayjs(Number(cast.expiryTimestamp)).fromNow()}</span>
            )}
          </div>
        </div>
      )}

      {/* Unlock flow */}
      {step === 'preview' && (
        <div className="space-y-4">
          {cast?.isExpired ? (
            <div className="bg-green-900/20 border border-green-800 rounded-xl px-5 py-4 text-sm text-green-300">
              This drop&apos;s paid window has closed — it&apos;s now free to read.
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-4 text-sm text-zinc-400">
              Cost to unlock:{' '}
              <span className="text-white font-medium">${totalCostDisplay} USDC</span>
              <span className="text-zinc-600 ml-2">
                (${baseToUsdc(cast?.priceBase ?? 0n)} to creator + $0.001 network fee)
              </span>
            </div>
          )}

          {session ? (
            <button
              onClick={handleUnlock}
              className="w-full py-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-base transition flex items-center justify-center gap-2"
            >
              <Unlock className="w-4 h-4" />
              {cast?.isExpired ? 'Read for free' : `Unlock for $${totalCostDisplay}`}
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-zinc-500 text-sm text-center">Sign in with Google to unlock this drop</p>
              <ZkLoginButton />
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">
            Encrypted client-side. Settled on-chain. Creator keeps 97%.{' '}
            Powered by{' '}
            <a href="https://conk.app" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-400 transition">
              CONK
            </a>.
          </p>
        </div>
      )}

      {step === 'unlocking' && (
        <div className="flex flex-col items-center py-16 gap-4">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <div className="text-center">
            <div className="text-white font-medium">Verifying payment…</div>
            <div className="text-zinc-500 text-sm mt-1">Confirming on-chain, retrieving your access key</div>
          </div>
        </div>
      )}

      {step === 'unlocked' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-400 mb-6">
            <Unlock className="w-5 h-5" />
            <span className="font-semibold">Unlocked</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6">
            <pre className="text-zinc-200 text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {content}
            </pre>
          </div>
          <p className="text-xs text-zinc-600 text-center">
            Decrypted in your browser. Never transmitted through any server.
          </p>
        </div>
      )}
    </div>
  )
}

function SpinnerView() {
  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
    </div>
  )
}

function ErrorView({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-4">
      <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
      <div className="text-white font-medium">Something went wrong</div>
      <div className="text-zinc-500 text-sm font-mono break-all">{msg}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-6 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-sm"
        >
          Try again
        </button>
      )}
    </div>
  )
}
