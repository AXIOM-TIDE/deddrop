/**
 * SEAL — AES-256-GCM browser encryption for Locked Drop
 *
 * Flow:
 *  create: generateKey() → encrypt(content) → [ciphertext, key]
 *          sound Cast with ciphertext as content bytes
 *          registerKey(castId, key) → zkProxy stores key in KV (45d TTL)
 *
 *  read:   releaseKey(castId, txDigest) → zkProxy verifies CastRead event → returns key
 *          decrypt(ciphertext, key) → plaintext
 */

export interface SealBundle {
  ciphertext: Uint8Array  // IV (12 bytes) + ciphertext + auth tag (16 bytes)
  keyB64: string          // base64-encoded AES-256-GCM key for zkProxy
}

/** Generate a fresh AES-256-GCM key and encrypt content. */
export async function sealEncrypt(plaintext: string): Promise<SealBundle> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable — we need to export it for zkProxy
    ['encrypt', 'decrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  // Prepend IV to ciphertext so decryption has everything it needs
  const combined = new Uint8Array(iv.byteLength + ciphertextBuf.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertextBuf), iv.byteLength)

  const rawKey = await crypto.subtle.exportKey('raw', key)
  const keyB64 = btoa(String.fromCharCode(...new Uint8Array(rawKey)))

  return { ciphertext: combined, keyB64 }
}

/** Decrypt ciphertext using a base64 AES key (returned by zkProxy). */
export async function sealDecrypt(ciphertext: Uint8Array, keyB64: string): Promise<string> {
  const rawKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw', rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const iv = ciphertext.slice(0, 12)
  const ct = ciphertext.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct
  )

  return new TextDecoder().decode(decrypted)
}

/** Register the AES key with zkProxy for the given castId. */
export async function registerKey(
  zkproxyUrl: string,
  castId: string,
  keyB64: string,
  senderAddress: string
): Promise<void> {
  const res = await fetch(`${zkproxyUrl}/register-seal-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ castId, key: keyB64, senderAddress }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`zkProxy key registration failed: ${res.status} ${err}`)
  }
}

/** Fetch the AES key from zkProxy after a verified CastRead transaction. */
export async function releaseKey(
  zkproxyUrl: string,
  castId: string,
  txDigest: string,
  readerAddress: string
): Promise<string> {
  const res = await fetch(`${zkproxyUrl}/seal-key/${castId}?txDigest=${txDigest}&reader=${readerAddress}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`zkProxy key release failed: ${res.status} ${err}`)
  }
  const { key } = await res.json()
  return key as string
}
