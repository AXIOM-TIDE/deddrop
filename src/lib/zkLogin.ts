/**
 * zkLogin for DEDDROP
 * Adapted from conk.app/src/sui/zkLogin.ts
 * Google → derived Sui address → no seed phrase.
 */

import { GOOGLE_CLIENT_ID, ZKPROXY_URL } from '../sui/config'
import type { ZkLoginSession } from './store'

export { GOOGLE_CLIENT_ID }
export type { ZkLoginSession }

// ── STEP 1: START LOGIN ───────────────────────────────────────
export async function startZkLogin(): Promise<void> {
  const { generateRandomness, generateNonce } = await import('@mysten/sui/zklogin')
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')

  const ephemeralKeypair = new Ed25519Keypair()
  const randomness = generateRandomness()

  const epochRes = await fetch(`${ZKPROXY_URL}/sui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getLatestSuiSystemState', params: [] }),
  })
  const epochData = await epochRes.json()
  const maxEpoch = Number(epochData.result?.epoch ?? 0) + 10

  sessionStorage.setItem('zklogin_ephemeral_secret', ephemeralKeypair.getSecretKey())
  sessionStorage.setItem('zklogin_randomness', randomness)
  sessionStorage.setItem('zklogin_maxEpoch', String(maxEpoch))

  const nonce = generateNonce(ephemeralKeypair.getPublicKey(), maxEpoch, randomness)

  // Save the current path so we can return here after the OAuth round-trip
  localStorage.setItem('zklogin_return_to', window.location.pathname + window.location.search)

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: 'id_token',
    scope: 'openid',
    nonce,
  })
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// ── STEP 2: HANDLE RETURN FROM GOOGLE ────────────────────────
export async function handleZkLoginCallback(): Promise<ZkLoginSession | null> {
  const hash = window.location.hash
  if (!hash.includes('id_token')) return null

  const params = new URLSearchParams(hash.slice(1))
  const jwt = params.get('id_token')
  if (!jwt) return null

  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  const { jwtToAddress, genAddressSeed, computeZkLoginAddressFromSeed } = await import('@mysten/sui/zklogin')
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')

  let salt = localStorage.getItem('zklogin_salt')
  if (!salt) {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    salt = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('zklogin_salt', salt)
  }

  const jwtPayload = JSON.parse(atob(jwt.split('.')[1]))
  const addressSeedValue = genAddressSeed(BigInt('0x' + salt), 'sub', jwtPayload.sub, jwtPayload.aud).toString()
  const address = jwtToAddress(jwt, BigInt('0x' + salt))

  const maxEpoch = Number(sessionStorage.getItem('zklogin_maxEpoch') ?? 0)
  const randomness = sessionStorage.getItem('zklogin_randomness') ?? ''
  const secretKey = sessionStorage.getItem('zklogin_ephemeral_secret') ?? ''
  const ephemeralKeypair = Ed25519Keypair.fromSecretKey(secretKey)
  const extendedKeyB64 = btoa(String.fromCharCode(...ephemeralKeypair.getPublicKey().toSuiBytes()))

  // Route ZK proof through zkProxy — keeps Enoki key server-side, avoids CORS issues
  let proof: unknown = null
  try {
    const resp = await fetch(`${ZKPROXY_URL}/zkproof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App': 'deddrop' },
      body: JSON.stringify({
        jwt,
        network:            'mainnet',
        ephemeralPublicKey: extendedKeyB64,
        maxEpoch,
        randomness,
        salt:               BigInt('0x' + salt).toString(),
        keyClaimName:       'sub',
      }),
    })
    if (resp.ok) proof = (await resp.json()).data
    else console.warn('ZK proof failed:', resp.status, await resp.text())
  } catch (e) {
    console.warn('ZK proof generation failed:', e)
  }

  const enokiAddressSeed = (proof as any)?.addressSeed ?? addressSeedValue
  const finalAddress = enokiAddressSeed !== addressSeedValue
    ? computeZkLoginAddressFromSeed(BigInt(enokiAddressSeed), 'https://accounts.google.com')
    : address

  const session: ZkLoginSession = { address: finalAddress, maxEpoch, salt, proof, addressSeed: enokiAddressSeed }
  sessionStorage.setItem('zklogin_session', JSON.stringify(session))
  return session
}

// ── SIGN + EXECUTE ────────────────────────────────────────────
export async function signAndExecute(
  tx: import('@mysten/sui/transactions').Transaction,
  session: ZkLoginSession
): Promise<import('@mysten/sui/client').SuiTransactionBlockResponse> {
  if (!session.proof) throw new Error('ZK proof not available — session may have expired. Please sign in again.')

  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519')
  const { getZkLoginSignature } = await import('@mysten/sui/zklogin')
  const { toB64 } = await import('@mysten/sui/utils')
  const { getSuiClient } = await import('./conk')

  const client = getSuiClient()
  const secretKey = sessionStorage.getItem('zklogin_ephemeral_secret') ?? ''
  const ephemeralKeypair = Ed25519Keypair.fromSecretKey(secretKey)

  const txBytes = await tx.build({ client: client as any })
  const { signature: ephemeralSig } = await ephemeralKeypair.signTransaction(txBytes)

  const proofWithSeed = {
    ...(session.proof as any),
    addressSeed: (session.proof as any).addressSeed ?? session.addressSeed ?? BigInt('0x' + session.salt).toString(),
  }

  const zkLoginSig = getZkLoginSignature({
    inputs: proofWithSeed,
    maxEpoch: session.maxEpoch,
    userSignature: ephemeralSig,
  })

  return client.executeTransactionBlock({
    transactionBlock: toB64(txBytes),
    signature: zkLoginSig,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
}

// ── HELPERS ───────────────────────────────────────────────────
export function getSession(): ZkLoginSession | null {
  try {
    const raw = sessionStorage.getItem('zklogin_session')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function isLoggedIn(): boolean { return !!getSession()?.proof }
export function logout(): void {
  sessionStorage.clear()
  localStorage.removeItem('zklogin_salt')
}
