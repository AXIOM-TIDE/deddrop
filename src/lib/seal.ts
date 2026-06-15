/**
 * SEAL — AES-256-GCM browser encryption for DEDDROP
 *
 * zkProxy endpoints (worker.js):
 *   POST /cast-key      → register key+iv after creator sounds a cast
 *   POST /cast-decrypt  → release key+iv after reader's read TX is verified on-chain
 *
 * Key format (required by zkProxy):
 *   key: 64 hex chars (32 bytes)
 *   iv:  24 hex chars (12 bytes)
 *   blobId: any non-empty string (use castId for DEDDROP — no Walrus integration)
 *
 * On-chain storage: content_blob stores raw ciphertext WITHOUT the IV prepended.
 * The IV is stored separately in zkProxy KV alongside the key.
 */

export interface SealBundle {
  ciphertext: Uint8Array  // raw AES-256-GCM ciphertext (no IV prefix)
  keyHex:     string      // 64 hex chars — 32-byte AES key
  ivHex:      string      // 24 hex chars — 12-byte IV
}

/** Generate a fresh AES-256-GCM key and encrypt plaintext. */
export async function sealEncrypt(plaintext: string): Promise<SealBundle> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )

  const rawKey = await crypto.subtle.exportKey('raw', key)

  const keyHex = Array.from(new Uint8Array(rawKey))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const ivHex = Array.from(iv)
    .map(b => b.toString(16).padStart(2, '0')).join('')

  return {
    ciphertext: new Uint8Array(ciphertextBuf),
    keyHex,
    ivHex,
  }
}

/** Decrypt ciphertext using hex key+iv (returned by zkProxy). */
export async function sealDecrypt(
  ciphertext: Uint8Array,
  keyHex: string,
  ivHex: string,
): Promise<string> {
  const rawKey = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16))).buffer
  const iv     = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))

  const key = await crypto.subtle.importKey(
    'raw', rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  // Ensure the buffer is a plain ArrayBuffer (not SharedArrayBuffer)
  const ctBuffer = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ctBuffer,
  )

  return new TextDecoder().decode(decrypted)
}

/**
 * Register the AES key+iv with zkProxy after cast::sound() confirms.
 * zkProxy stores the key for up to 45 days.
 * blobId: use castId (DEDDROP has no Walrus integration).
 */
export async function registerKey(
  zkproxyUrl:  string,
  castId:      string,
  keyHex:      string,
  ivHex:       string,
): Promise<void> {
  const res = await fetch(`${zkproxyUrl}/cast-key`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ castId, key: keyHex, iv: ivHex, blobId: castId }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`zkProxy key registration failed: ${res.status} ${err}`)
  }
}

/**
 * Fetch decryption key from zkProxy after a verified cast::read() transaction.
 * zkProxy verifies the on-chain CastRead event before releasing.
 */
export async function releaseKey(
  zkproxyUrl:    string,
  castId:        string,
  txDigest:      string,
  readerAddress: string,
): Promise<{ keyHex: string; ivHex: string }> {
  const res = await fetch(`${zkproxyUrl}/cast-decrypt`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ castId, txDigest, address: readerAddress }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`zkProxy key release failed: ${res.status} ${err}`)
  }
  const { key, iv } = await res.json()
  return { keyHex: key, ivHex: iv }
}
