/**
 * DropPage — Buyer flow
 * Route: /d/:castId
 *
 * Step 1: Fetch Cast metadata → show hook + price
 * Step 2: zkLogin (if not signed in)
 * Step 3: Ensure Harbor funded
 * Step 4: Execute cast::read() TX
 * Step 5: Fetch SEAL key from zkProxy → decrypt → render content
 */

import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Unlock, Loader2, AlertCircle, Eye, DollarSign } from 'lucide-react'
import { Transaction } from '@mysten/sui/transactions'
import { useStore } from '../lib/store'
import { releaseKey, sealDecrypt } from '../lib/seal'
import { buildReadCast, fetchCast, findHarbor, baseToUsdc, CastInfo } from '../lib/conk'
import { signAndExecute } from '../lib/zkLogin'
import { ZKPROXY_URL, PROTOCOL_READ_FEE } from '../sui/config'
import ZkLoginButton from '../components/ZkLoginButton'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

type Step = 'loading' | 'preview' | 'login' | 'unlocking' | 'unlocked' | 'error'

export default function DropPage() {
  const { castId } = useParams<{ castId: string }>()
  const { session, harborId, setHarborId } = useStore()

  const [cast, setCast] = useState<CastInfo | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [content, setContent] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!castId) return
    fetchCast(castId)
      .then(c => { setCast(c); setStep('preview') })
      .catch(e => { setErrorMsg(e.message); setStep('error') })
  }, [castId])

  async function handleUnlock() {
    if (!cast || !session || !castId) return

    try {
      setStep('unlocking')

      // Ensure Harbor exists and has enough balance
      let harbor = harborId ?? await findHarbor(session.address)
      if (!harbor) throw new Error('No Harbor found. Please fund your wallet first.')
      setHarborId(harbor)

      // We need the author's Harbor ID too
      // For v1: look it up from the Vessel object
      const authorHarborId = await fetchAuthorHarborId(cast.authorVesselId)
      if (!authorHarborId) throw new Error('Could not find author Harbor. The drop may be invalid.')

      // Build and execute read TX
      const tx = new Transaction()
      tx.setSender(session.address)
      buildReadCast(tx, {
        castId,
        harborId: harbor,
        authorHarborId,
      })

      const result = await signAndExecute(tx, session)
      if (result.effects?.status?.status !== 'success') {
        throw new Error('Read TX failed: ' + JSON.stringify(result.effects?.status))
      }

      const txDigest = result.digest
      if (!txDigest) throw new Error('No TX digest returned')

      // Fetch SEAL key from zkProxy (verifies the CastRead event on-chain)
      const keyB64 = await releaseKey(ZKPROXY_URL, castId, txDigest, session.address)

      // Decrypt content
      if (!cast.contentBytes || cast.contentBytes.length === 0) {
        throw new Error('Cast has no content to decrypt')
      }
      const plaintext = await sealDecrypt(cast.contentBytes, keyB64)
      setContent(plaintext)
      setStep('unlocked')
    } catch (e: any) {
      console.error(e)
      setErrorMsg(e.message ?? 'Unknown error')
      setStep('error')
    }
  }

  if (!castId) return <ErrorView msg="Invalid drop link" />
  if (step === 'loading') return <SpinnerView />
  if (step === 'error') return <ErrorView msg={errorMsg} onRetry={() => setStep('preview')} />

  const totalCostBase = (cast?.priceBase ?? 0n) + PROTOCOL_READ_FEE
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
              This drop’s paid window has closed — it’s now free to read.
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-4 text-sm text-zinc-400">
              Cost to unlock: <span className="text-white font-medium">${totalCostDisplay} USDC</span>
              <span className="text-zinc-600 ml-2">
                (${baseToUsdc(cast?.priceBase ?? 0n)} to creator + $0.001 protocol fee)
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
              <p className="text-zinc-500 text-sm text-center">Sign in to unlock this drop</p>
              <ZkLoginButton onSuccess={handleUnlock} />
            </div>
          )}

          <p className="text-center text-xs text-zinc-600">
            Encrypted client-side. Settled on-chain. Creator keeps 97%.
            Powered by <a href="https://conk.app" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-400 transition">CONK</a>.
          </p>
        </div>
      )}

      {step === 'unlocking' && (
        <div className="flex flex-col items-center py-16 gap-4">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          <div className="text-center">
            <div className="text-white font-medium">Verifying payment…</div>
            <div className="text-zinc-500 text-sm mt-1">Confirming on-chain, fetching decryption key</div>
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
            Decrypted in your browser. Never passed through any server.
          </p>
        </div>
      )}
    </div>
  )
}

/** Fetch the Harbor ID belonging to the vessel's owner (needed for read() routing). */
async function fetchAuthorHarborId(vesselId: string): Promise<string | null> {
  const { getSuiClient } = await import('../lib/conk')
  const client = getSuiClient()
  const obj = await client.getObject({ id: vesselId, options: { showContent: true } })
  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') return null
  const fields = (obj.data.content as any).fields
  return fields?.harbor_id ?? null
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
        <button onClick={onRetry} className="mt-4 px-6 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition text-sm">
          Try again
        </button>
      )}
    </div>
  )
}
