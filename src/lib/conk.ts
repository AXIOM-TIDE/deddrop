/**
 * CONK SDK wrappers for DEDDROP — v13 compatible
 *
 * Struct types: Harbor, Vessel, VesselCap are anchored at CONK_TYPE_ANCHOR (v11).
 * cast::sound / cast::read use the current CONK_PACKAGE (v13+).
 *
 * cast::sound  → fee_coin, abyss, vessel, vessel_cap, hook, content_blob,
 *                media_blob, mode, recipient, duration, fee, max_claims,
 *                dock_description, clock
 * cast::read   → cast, fee_coin, abyss, config, reader, clock
 *              (NO Harbor in v13 — author gets 97% sent directly to their address)
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, SuiHTTPTransport } from '@mysten/sui/client'
import {
  CONK_PACKAGE, CONK_TYPE_ANCHOR,
  ABYSS_ID, PROTOCOL_CONFIG, SUI_CLOCK,
  SUI_RPC, USDC_TYPE, USDC_DECIMALS,
  PROTOCOL_READ_FEE, PROTOCOL_CAST_FEE,
  MODE_OPEN, DUR_7D,
  HARBOR_TIER_1, HARBOR_TIER1_TOTAL, VESSEL_TIER_OPEN,
} from '../sui/config'

export function getSuiClient(): SuiClient {
  return new SuiClient({ transport: new SuiHTTPTransport({ url: SUI_RPC }) })
}

// ── Harbor ──────────────────────────────────────────────────────────────────

/**
 * Build a TX to open a Tier-1 Harbor.
 * Requires a USDC coin with at least HARBOR_TIER1_TOTAL ($0.15) balance.
 * Returns the HarborCap — caller must tx.transferObjects([harborCap], owner).
 */
export function buildOpenHarbor(tx: Transaction, usdcCoinId: string) {
  const [paymentCoin] = tx.splitCoins(
    tx.object(usdcCoinId),
    [tx.pure.u64(HARBOR_TIER1_TOTAL)],
  )
  return tx.moveCall({
    target: `${CONK_PACKAGE}::harbor::open`,
    arguments: [
      paymentCoin,
      tx.pure.u8(HARBOR_TIER_1),
      tx.object(SUI_CLOCK),
    ],
  })
}

// ── Vessel ───────────────────────────────────────────────────────────────────

/**
 * Build a TX to launch a Vessel from an existing Harbor.
 * Returns the VesselCap — caller must tx.transferObjects([vesselCap], owner).
 */
export function buildLaunchVessel(tx: Transaction, harborId: string) {
  return tx.moveCall({
    target: `${CONK_PACKAGE}::vessel::launch`,
    arguments: [
      tx.pure.address(harborId),
      tx.pure.u8(VESSEL_TIER_OPEN),
      tx.pure.bool(false),            // burn_after_cast: false
      tx.object(SUI_CLOCK),
    ],
  })
}

// ── Cast ─────────────────────────────────────────────────────────────────────

export interface SoundCastArgs {
  vesselId:    string
  vesselCapId: string
  hook:        string          // public preview text (max ~120 chars)
  ciphertext:  Uint8Array      // AES-256-GCM encrypted content (WITHOUT IV prepended)
  priceBase:   bigint          // read price in USDC base units (e.g. 1000000n = $1)
  usdcCoinId:  string          // object ID of creator's USDC coin
}

/** Build a TX to sound (publish) a SEAL-encrypted Cast (v13 API). */
export function buildSoundCast(tx: Transaction, args: SoundCastArgs): void {
  const [feeCoin] = tx.splitCoins(
    tx.object(args.usdcCoinId),
    [tx.pure.u64(PROTOCOL_CAST_FEE)],
  )

  const contentBytes = Array.from(args.ciphertext)

  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::sound`,
    arguments: [
      feeCoin,
      tx.object(ABYSS_ID),
      tx.object(args.vesselId),
      tx.object(args.vesselCapId),
      tx.pure.string(args.hook),                     // hook: vector<u8>
      tx.pure.vector('u8', contentBytes),            // content_blob
      tx.pure.option('vector<u8>', null),            // media_blob: none for DEDDROP
      tx.pure.u8(MODE_OPEN),                         // mode: open (anyone can pay)
      tx.pure.address('0x0000000000000000000000000000000000000000000000000000000000000000'), // recipient: unused for MODE_OPEN
      tx.pure.u8(DUR_7D),                            // duration: 7 days
      tx.pure.u64(args.priceBase),                   // fee: read price set by creator
      tx.pure.u64(1n),                               // max_claims: 1 (min; doesn't gate MODE_OPEN)
      tx.pure.vector('u8', []),                      // dock_description: empty
      tx.object(SUI_CLOCK),
    ],
  })
}

export interface ReadCastArgs {
  castId:       string
  readerAddress: string
  usdcCoinId:   string   // reader's USDC coin object
  priceBase:    bigint   // cast.fee_paid (from fetchCast)
}

/**
 * Build a TX to pay for and read a Cast (v13 API).
 * No Harbor needed — fee splits: author gets 97% direct, Abyss gets 3%+flat.
 */
export function buildReadCast(tx: Transaction, args: ReadCastArgs): void {
  const totalFee = args.priceBase + PROTOCOL_READ_FEE
  const [feeCoin] = tx.splitCoins(
    tx.object(args.usdcCoinId),
    [tx.pure.u64(totalFee)],
  )

  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::read`,
    arguments: [
      tx.object(args.castId),
      feeCoin,
      tx.object(ABYSS_ID),
      tx.object(PROTOCOL_CONFIG),
      tx.pure.address(args.readerAddress),
      tx.object(SUI_CLOCK),
    ],
  })
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface CastInfo {
  castId:          string
  hook:            string
  priceBase:       bigint
  authorVesselId:  string
  author:          string
  expiryTimestamp: bigint
  isExpired:       boolean
  contentBytes?:   Uint8Array
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

  // v13 field name is content_blob (not content)
  const contentBytesRaw: number[] = fields.content_blob ?? []
  const contentBytes = new Uint8Array(contentBytesRaw)

  // v13 field name is fee_paid (not price)
  const priceBase = BigInt(fields.fee_paid ?? 0)

  // v13 field name is expires_at (not expiry)
  const expiryTimestamp = BigInt(fields.expires_at ?? 0)
  const isExpired = expiryTimestamp > 0n && BigInt(Date.now()) > expiryTimestamp

  const author: string = fields.author ?? ''

  // vessel_id is stored as Move ID type (serialized as hex address string in RPC)
  const authorVesselId: string = typeof fields.vessel_id === 'object'
    ? (fields.vessel_id?.id ?? fields.vessel_id ?? '')
    : (fields.vessel_id ?? '')

  return { castId, hook, priceBase, authorVesselId, author, expiryTimestamp, isExpired, contentBytes }
}

/**
 * Find Harbor owned by an address.
 * Uses CONK_TYPE_ANCHOR (v11) — harbor.move has not changed since v11.
 */
export async function findHarbor(ownerAddress: string): Promise<string | null> {
  const client = getSuiClient()
  const objs = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: `${CONK_TYPE_ANCHOR}::harbor::Harbor` },
    options: { showContent: false },
  })
  return objs.data[0]?.data?.objectId ?? null
}

/**
 * Find Vessels owned by an address.
 * Uses CONK_TYPE_ANCHOR (v11) — vessel.move has not changed since v11.
 */
export async function findVessels(ownerAddress: string): Promise<string[]> {
  const client = getSuiClient()
  const objs = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: `${CONK_TYPE_ANCHOR}::vessel::Vessel` },
    options: { showContent: false },
  })
  return objs.data.map(o => o.data?.objectId).filter(Boolean) as string[]
}

/**
 * Find VesselCap owned by an address (needed for cast::sound).
 * Returns the first VesselCap's objectId or null.
 */
export async function findVesselCap(ownerAddress: string): Promise<string | null> {
  const client = getSuiClient()
  const objs = await client.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: `${CONK_TYPE_ANCHOR}::vessel::VesselCap` },
    options: { showContent: false },
  })
  return objs.data[0]?.data?.objectId ?? null
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
