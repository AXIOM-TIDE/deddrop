/**
 * DEDDROP E2E Agent Test
 *
 * Simulates the full creator → buyer loop using agent private keys.
 * NEURAL = creator, SPARK = buyer.
 *
 * ⚠️  COLD-START CAVEAT:
 * Agents have pre-funded USDC wallets. A real human buyer with an empty wallet
 * will hit "Insufficient USDC" before the unlock step. This path is NOT tested
 * here — it requires a human-run test. Flag in bug report.
 *
 * Runs on Sui MAINNET against the configured CONK v14 package.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiClient, SuiHTTPTransport } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { toB64 } from '@mysten/sui/utils'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import crypto from 'crypto'

// ── Config ─────────────────────────────────────────────────────────────────

const SUI_RPC       = 'https://deddrop.app/zkproxy/sui'
const ZKPROXY_URL   = 'https://deddrop.app/zkproxy'
const CONK_PACKAGE  = '0x265ec216d95c6109f92d90e310da4cfb0c123efa1c00540d8ced4e0d37392297'  // v14
const ABYSS_ID      = '0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0'
const PROTO_CFG     = '0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea'
const SUI_CLOCK     = '0x0000000000000000000000000000000000000000000000000000000000000006'
const USDC_TYPE     = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const ANCHOR_PKG    = '0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc'

// Known agent objects from Registry
const NEURAL_VESSEL     = '0x14317d559b68be6df0ff8bda7f16c66283184a808e1d0392ed19fc0c40865356'
const NEURAL_VESSEL_CAP = '0x440cd562f48a890084fb713aa1b134e4709caef783db525c1f1497b323fff007'
const SPARK_VESSEL      = '0x7184921bdcb438cd9804adda4d384e2fe5c6abcbb920c759f1728d4430492bfb'

const CAST_PRICE_BASE = 1000n  // $0.001 per read
const PROTO_READ_FEE  = 1000n  // flat protocol fee
const CAST_PUB_FEE    = 1000n  // fee to publish cast

const MODE_OPEN = 0
const DUR_7D    = 4

// ── Credentials (injected by test runner) ─────────────────────────────────
const NEURAL_KEY = process.env.NEURAL_KEY
const SPARK_KEY  = process.env.SPARK_KEY

if (!NEURAL_KEY || !SPARK_KEY) {
  console.error('❌ Set NEURAL_KEY and SPARK_KEY env vars')
  process.exit(1)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const client = new SuiClient({ transport: new SuiHTTPTransport({ url: SUI_RPC }) })

function makeKeypair(hexKey) {
  // Railway stores keys as suiprivkey1... bech32 or raw 0x hex.
  // Try decodeSuiPrivateKey first (handles suiprivkey1... format),
  // fall back to raw hex bytes.
  try {
    const { secretKey } = decodeSuiPrivateKey(hexKey)
    return Ed25519Keypair.fromSecretKey(secretKey)
  } catch {
    const bytes = Buffer.from(hexKey.replace(/^0x/, ''), 'hex')
    return Ed25519Keypair.fromSecretKey(bytes)
  }
}

async function signAndExecute(tx, keypair) {
  const txBytes = await tx.build({ client })
  const { signature } = await keypair.signTransaction(txBytes)
  return client.executeTransactionBlock({
    transactionBlock: toB64(txBytes),
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
}

async function getUsdcCoin(ownerAddress, minBalance) {
  const coins = await client.getCoins({ owner: ownerAddress, coinType: USDC_TYPE })
  const sorted = coins.data.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))
  const coin = sorted.find(c => BigInt(c.balance) >= minBalance)
  if (!coin) throw new Error(`Insufficient USDC. Need ${minBalance} base units. Have: ${sorted.map(c => c.balance).join(', ')}`)
  return coin
}

// ── AES-256-GCM Encryption ────────────────────────────────────────────────

function sealEncrypt(plaintext) {
  const key = crypto.randomBytes(32)
  const iv  = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const ciphertext = Buffer.concat([enc, tag])
  return {
    ciphertext: new Uint8Array(ciphertext),
    keyHex: key.toString('hex'),
    ivHex:  iv.toString('hex'),
  }
}

function sealDecrypt(ciphertext, keyHex, ivHex) {
  const key = Buffer.from(keyHex, 'hex')
  const iv  = Buffer.from(ivHex, 'hex')
  const ct  = Buffer.from(ciphertext)
  // AES-256-GCM auth tag is last 16 bytes
  const tag  = ct.slice(-16)
  const data = ct.slice(0, -16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(data) + decipher.final('utf8')
}

// ── Step 1: Creator (NEURAL) — sound a cast ────────────────────────────────

async function creatorSoundCast() {
  console.log('\n[1] Creator (N.E.U.R.A.L.) — sound a drop...')
  const keypair = makeKeypair(NEURAL_KEY)
  const address = keypair.getPublicKey().toSuiAddress()
  console.log(`    Address: ${address}`)

  const content = `DEDDROP E2E TEST DROP — ${new Date().toISOString()}\n\nThis is test content encrypted with AES-256-GCM and stored on Sui via CONK v13.`
  const hook    = 'E2E test drop — agent automated run'
  const { ciphertext, keyHex, ivHex } = sealEncrypt(content)

  const usdcCoin = await getUsdcCoin(address, CAST_PUB_FEE + 1000n)
  const tx = new Transaction()
  tx.setSender(address)

  const [feeCoin] = tx.splitCoins(tx.object(usdcCoin.coinObjectId), [tx.pure.u64(CAST_PUB_FEE)])

  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::sound`,
    arguments: [
      feeCoin,
      tx.object(ABYSS_ID),
      tx.object(NEURAL_VESSEL),
      tx.object(NEURAL_VESSEL_CAP),
      tx.pure.string(hook),
      tx.pure.vector('u8', Array.from(ciphertext)),
      tx.pure.option('vector<u8>', null),
      tx.pure.u8(MODE_OPEN),
      tx.pure.address(address),
      tx.pure.u8(DUR_7D),
      tx.pure.u64(CAST_PRICE_BASE),
      tx.pure.u64(1n),
      tx.pure.vector('u8', []),
      tx.object(SUI_CLOCK),
    ],
  })

  const result = await signAndExecute(tx, keypair)
  if (result.effects?.status?.status !== 'success') {
    throw new Error('cast::sound failed: ' + JSON.stringify(result.effects?.status))
  }

  // Extract castId from CastSounded event
  const event = result.events?.find(e => e.type?.endsWith('::cast::CastSounded'))
  if (!event) throw new Error('No CastSounded event in TX result')

  const castId = '0x' + (event.parsedJson?.cast_id ?? '').replace(/^0x/, '')
  console.log(`    ✅ Cast sounded: ${castId}`)
  console.log(`    ✅ TX digest:    ${result.digest}`)
  console.log(`    ✅ Expires at:   ${new Date(Number(event.parsedJson?.expires_at)).toISOString()}`)

  return { castId, keyHex, ivHex, content, soundTx: result.digest }
}

// ── Step 2: Register SEAL key with zkProxy ─────────────────────────────────

async function registerSealKey(castId, keyHex, ivHex) {
  console.log('\n[2] Register SEAL key with zkProxy...')
  const res = await fetch(`${ZKPROXY_URL}/cast-key`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://deddrop.app' },
    body:    JSON.stringify({ castId, key: keyHex, iv: ivHex, blobId: castId }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error('cast-key registration failed: ' + JSON.stringify(data))
  console.log('    ✅ Key registered in zkProxy KV (45d TTL)')
}

// ── Step 3: Fetch cast via fetchCast (v13 field names) ─────────────────────

async function verifyCastFetch(castId, expectedPrice) {
  console.log('\n[3] Verify fetchCast field names (v13)...')
  const obj = await client.getObject({ id: castId, options: { showContent: true } })
  const fields = obj.data?.content?.fields ?? {}

  const checks = [
    ['hook', fields.hook?.length > 0, `hook bytes: ${fields.hook?.length}`],
    ['content_blob', fields.content_blob?.length > 0, `content_blob bytes: ${fields.content_blob?.length}`],
    ['fee_paid', BigInt(fields.fee_paid ?? 0) === expectedPrice, `fee_paid=${fields.fee_paid}`],
    ['expires_at', BigInt(fields.expires_at ?? 0) > BigInt(Date.now()), `expires_at=${fields.expires_at}`],
    ['vessel_id', !!fields.vessel_id, `vessel_id=${typeof fields.vessel_id === 'object' ? JSON.stringify(fields.vessel_id) : fields.vessel_id}`],
  ]

  let allOk = true
  for (const [name, ok, detail] of checks) {
    console.log(`    ${ok ? '✅' : '❌'} ${name}: ${detail}`)
    if (!ok) allOk = false
  }
  if (!allOk) throw new Error('fetchCast field validation failed — check v13 field names')
  return fields
}

// ── Step 4: Buyer (SPARK) — read the cast ──────────────────────────────────

async function buyerReadCast(castId, priceBase) {
  console.log('\n[4] Buyer (S.P.A.R.K.) — read the drop...')
  const keypair = makeKeypair(SPARK_KEY)
  const address = keypair.getPublicKey().toSuiAddress()
  console.log(`    Address: ${address}`)

  const totalFee = priceBase + PROTO_READ_FEE
  const usdcCoin = await getUsdcCoin(address, totalFee + 1000n)

  const tx = new Transaction()
  tx.setSender(address)
  const [feeCoin] = tx.splitCoins(tx.object(usdcCoin.coinObjectId), [tx.pure.u64(totalFee)])
  tx.moveCall({
    target: `${CONK_PACKAGE}::cast::read`,
    arguments: [
      tx.object(castId),
      feeCoin,
      tx.object(ABYSS_ID),
      tx.object(PROTO_CFG),
      tx.pure.address(address),
      tx.object(SUI_CLOCK),
    ],
  })

  const result = await signAndExecute(tx, keypair)
  if (result.effects?.status?.status !== 'success') {
    throw new Error('cast::read failed: ' + JSON.stringify(result.effects?.status))
  }

  const readEvent = result.events?.find(e => e.type?.endsWith('::cast::CastRead'))
  if (!readEvent) throw new Error('No CastRead event in TX result')

  console.log(`    ✅ cast::read succeeded: ${result.digest}`)
  console.log(`    ✅ read_count = ${readEvent.parsedJson?.read_count}`)
  return { readTx: result.digest, readerAddress: address }
}

// ── Step 5: Decrypt via zkProxy ─────────────────────────────────────────────

async function decryptViaZkProxy(castId, txDigest, readerAddress) {
  console.log('\n[5] zkProxy /cast-decrypt — verify payment + release key...')
  const res = await fetch(`${ZKPROXY_URL}/cast-decrypt`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://deddrop.app' },
    body:    JSON.stringify({ castId, txDigest, address: readerAddress }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`/cast-decrypt failed: ${res.status} ${err}`)
  }
  const { key, iv } = await res.json()
  console.log(`    ✅ zkProxy released key (${key?.length} hex chars key, ${iv?.length} hex chars iv)`)
  return { keyHex: key, ivHex: iv }
}

// ── Step 6: Verify return-path logic (static code check) ───────────────────

function verifyReturnPath() {
  console.log('\n[6] Return-path logic check (static)...')
  console.log('    startZkLogin() saves: window.location.pathname + search → localStorage zklogin_return_to')
  console.log('    ZkCallbackHandler reads: zklogin_return_to → navigate(returnTo, {replace:true})')
  console.log('    Default fallback: /create (used when no return_to set)')
  console.log('    If buyer on /d/:castId clicks "Sign in": saves /d/:castId → returns there after OAuth')
  console.log('    ✅ Return-path to DROP page: logic correct per code review')
  console.log('    ⚠️  NOT browser-tested: requires live OAuth round-trip with real Google account')
}

// ── Step 7: Cold-start flag ────────────────────────────────────────────────

function flagColdStart() {
  console.log('\n[7] Cold-start funding friction — UNTESTED ⚠️')
  console.log('    Agents have pre-funded USDC. Real human buyer flow NOT tested.')
  console.log('    A new user with empty wallet hits: "Insufficient USDC. Need $X.XX"')
  console.log('    No in-app USDC funding / bridge UI exists in DEDDROP.')
  console.log('    Human test required: fund new wallet → open drop link → zkLogin → pay → decrypt')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  DEDDROP E2E AGENT TEST — v14 MAINNET')
  console.log(`  ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════════')

  try {
    const { castId, keyHex, ivHex, content } = await creatorSoundCast()
    await registerSealKey(castId, keyHex, ivHex)
    const fields = await verifyCastFetch(castId, CAST_PRICE_BASE)
    const priceBase = BigInt(fields.fee_paid)
    const { readTx, readerAddress } = await buyerReadCast(castId, priceBase)

    // Brief wait for TX to index on-chain before zkProxy verifies it
    console.log('\n    Waiting 3s for TX indexing...')
    await new Promise(r => setTimeout(r, 3000))

    const { keyHex: releasedKey, ivHex: releasedIv } = await decryptViaZkProxy(castId, readTx, readerAddress)

    // Verify decryption matches original
    console.log('\n[5b] Decrypt and verify content...')
    const contentBytes = new Uint8Array(fields.content_blob)
    const decrypted = sealDecrypt(contentBytes, releasedKey, releasedIv)
    const matches = decrypted === content
    console.log(`    ${matches ? '✅' : '❌'} Decrypted content ${matches ? 'matches original' : 'MISMATCH'}`)
    if (!matches) {
      console.log('    Expected:', content.slice(0, 60))
      console.log('    Got:     ', decrypted.slice(0, 60))
    }

    verifyReturnPath()
    flagColdStart()

    console.log('\n═══════════════════════════════════════════════════')
    console.log('  RESULTS')
    console.log('═══════════════════════════════════════════════════')
    console.log(`  [1] Creator cast::sound:    ✅  castId=${castId}`)
    console.log(`  [2] zkProxy /cast-key:      ✅`)
    console.log(`  [3] fetchCast v13 fields:   ✅`)
    console.log(`  [4] Buyer cast::read:        ✅  readTx=${readTx}`)
    console.log(`  [5] zkProxy /cast-decrypt:  ✅`)
    console.log(`  [5b] AES decrypt+verify:    ${matches ? '✅' : '❌'}`)
    console.log(`  [6] Return-path logic:      ✅ (code review — browser test pending)`)
    console.log(`  [7] Cold-start USDC:        ⚠️  UNTESTED — human run required`)
    console.log('═══════════════════════════════════════════════════')
  } catch (e) {
    console.error('\n❌ TEST FAILED:', e.message)
    console.error(e.stack)
    process.exit(1)
  }
}

main()
