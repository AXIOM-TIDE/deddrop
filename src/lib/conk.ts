/**
 * CONK SDK wrappers for Locked Drop
 *
 * Uses @mysten/sui directly (avoids conk-sdk version dependency during v0.7.0 staging).
 * Swap to @axiomtide/conk-sdk once v0.7.0 publishes.
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, SuiHTTPTransport } from '@mysten/sui/client'
import {
  CONK_PACKAGE, ABYSS_ID, DRIFT_ID, PROTOCOL_CONFIG,
  SUI_RPC, USDC_TYPE, USDC_DECIMALS, PROTOCOL_READ_FEE, DROP_EXPIRY_MS,
} from '../sui/config'

export function getSuiClient(): SuiClient {
  return new SuiClient({ transport: new SuiHTTPTransport({ url: SUI_RPC }) })
}

// ── Harbor ──────────────────────────────────────────────────────────────────

/** Build a TX to open a Harbor and fund it with USDC. */
export function buildOpenHarbor(tx: Transaction): void {
  tx.moveCall({
    target: `${CONK_PACKAGE}::harbor::open`,
    arguments: [],
  })
}

/** Deposit USDC into Harbor. coinObjectId = USDC coin to split from. */
export function buildDepositHarbor(
  tx: Transaction,
  harborId: string,
  usdcCoinId: string,
  amountBase: bigint,
): void {
  const [depositCoin] = tx.splitCoins(tx.object(usdcCoinId), [tx.pure.u64(amountBase)])
  tx.moveCall({
    target: `${CONK_PACKAGE}::harbor::deposit`,
    typeArguments: [USDC_TYPE],
    arguments: [tx.object(harborId), depositCoin],
  })
}

// ── Vessel ───────────────────────────────────────────────────────────────────

/** Build a TX to launch a Vessel from a Harbor. */
export function buildLaunchVessel(tx: Transaction, harborId: string): void {
  tx.moveCall({
    target: `${CONK_PACKAGE}::vessel::launch`,
    arguments: [tx.object(harborId)],
  })
}

// ── Cast ─────────────────────────────────────────────────────────────────────

export interface SoundCastArgs {
  vesselId: string
  hook: string         // public preview text (max ~100 chars recommended)
  ciphertext: Uint8Array  // AES-256-GCM encrypted content
  priceBase: bigint    // author-set read price in USDC base units (e.g. 1000000n = $1)
  expiryMs?: number    // ms from now; defaults to DROP_EXPIRY_MS (30 days)
}

/** Build a TX to sound (publish) a SEAL-encrypted Cast. */
export function buildSoundCast(tx: Transaction, args: SoundCastArgs): void {
  const expiryMs = args.expiryMs ?? DROP_EXPIRY_MS
  const expiryTimestamp = BigInt(Date.now() + expiryMs)

  const hookBytes = Array.from(new TextEncoder().encode(args.hook))
  const contentBytes = Array.from(args.ciphertext)

  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::sound`,
    arguments: [
      tx.object(args.vesselId),
      tx.object(DRIFT_ID),
      tx.object(ABYSS_ID),
      tx.object(PROTOCOL_CONFIG),
      tx.pure.vector('u8', hookBytes),
      tx.pure.vector('u8', contentBytes),
      tx.pure.u64(args.priceBase),
      tx.pure.u64(expiryTimestamp),
    ],
  })
}

export interface ReadCastArgs {
  castId: string
  harborId: string        // reader's Harbor (holds USDC)
  authorHarborId: string  // cast author's Harbor (receives 97%)
}

/** Build a TX to pay for and read a Cast. Returns the TX for signing. */
export function buildReadCast(tx: Transaction, args: ReadCastArgs): void {
  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::read`,
    arguments: [
      tx.object(args.castId),
      tx.object(args.harborId),
      tx.object(args.authorHarborId),
      tx.object(ABYSS_ID),
      tx.object(PROTOCOL_CONFIG),
    ],
  })
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface CastInfo {
  castId: string
  hook: string
  priceBase: bigint
  authorVesselId: string
  authorHarborId?: string
  expiryTimestamp: bigint
  isExpired: boolean
  contentBytes?: Uint8Array
}

/** Fetch cast details from chain by object ID. */
export async function fetchCast(castId: string): Promise<CastInfo> {
  const client = getSuiClient()
  const obj = await client.getObject({
    id: castId,
    options: { showContent: true },
  })

  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
    throw new Error(`Cast ${castId} not found`)
  }

  const fields = (obj.data.content as any).fields as Record<string, any>

  const hookBytes: number[] = fields.hook ?? []
  const hook = new TextDecoder().decode(new Uint8Array(hookBytes))

  const contentBytesRaw: number[] = fields.content ?? []
  const contentBytes = new Uint8Array(contentBytesRaw)

  const priceBase = BigInt(fields.price ?? 0)
  const expiryTimestamp = BigInt(fields.expiry ?? 0)
  const isExpired = expiryTimestamp > 0n && BigInt(Date.now()) > expiryTimestamp

  // Author Harbor: find from vessel → harbor lookup
  const authorVesselId: string = fields.vessel_id ?? ''

  return { castId, hook, priceBase, authorVesselId, expiryTimestamp, isExpired, contentBytes }
}

/** Find Harbor owned by an address. Returns first Harbor object ID or null. */
export async function findHarbor(ownerAddress: string): Promise<string | null> {
  const client = getSuiClient()
  const objs = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: `${CONK_PACKAGE}::harbor::Harbor` },
    options: { showContent: false },
  })
  return objs.data[0]?.data?.objectId ?? null
}

/** Find Vessels owned by an address. Returns array of vessel object IDs. */
export async function findVessels(ownerAddress: string): Promise<string[]> {
  const client = getSuiClient()
  const objs = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: `${CONK_PACKAGE}::vessel::Vessel` },
    options: { showContent: false },
  })
  return objs.data.map(o => o.data?.objectId).filter(Boolean) as string[]
}

/** Find USDC coins owned by an address, sorted by balance descending. */
export async function findUsdcCoins(ownerAddress: string) {
  const client = getSuiClient()
  const coins = await client.getCoins({ owner: ownerAddress, coinType: USDC_TYPE })
  return coins.data.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))
}

/** Convert USDC display amount (e.g. "1.50") to base units. */
export function usdcToBase(display: string): bigint {
  const [whole, frac = ''] = display.split('.')
  const fracPadded = frac.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded)
}

/** Convert base units to USDC display string. */
export function baseToUsdc(base: bigint): string {
  const whole = base / BigInt(10 ** USDC_DECIMALS)
  const frac = base % BigInt(10 ** USDC_DECIMALS)
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '') || '00'}`
}
