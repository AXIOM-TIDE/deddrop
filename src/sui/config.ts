// CONK protocol addresses — update CONK_PACKAGE to v14 after prod deploy
export const CONK_PACKAGE    = import.meta.env.VITE_CONK_PACKAGE
  ?? '0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6' // v13 fallback

// Type-anchor package: Harbor, Vessel, VesselCap types are anchored here.
// harbor.move and vessel.move have not changed since v11, so struct types
// still use this address even when interacting via the v13+ package.
export const CONK_TYPE_ANCHOR = '0x734b19fa1696dec30f8cae38f1cdbf0ab5a12720735f7c7b0d4935cab31732cc'

export const ABYSS_ID        = '0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0'
export const DRIFT_ID        = '0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad'
export const PROTOCOL_CONFIG = '0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea'
export const SUI_CLOCK       = '0x0000000000000000000000000000000000000000000000000000000000000006'

export const SUI_RPC         = import.meta.env.VITE_SUI_RPC
  ?? 'https://conk-zkproxy-v2.italktonumbers.workers.dev/sui'
export const ZKPROXY_URL     = import.meta.env.VITE_ZKPROXY_URL
  ?? 'https://conk-zkproxy-v2.italktonumbers.workers.dev'
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

// USDC coin type on Sui mainnet
export const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
// USDC decimals
export const USDC_DECIMALS = 6

// Protocol fees (base units = USDC micro-units, 1e6 = $1)
export const PROTOCOL_READ_FEE    = 1000n  // $0.001 — flat reader fee to Abyss
export const PROTOCOL_CAST_FEE    = 1000n  // $0.001 — cast publication fee to Abyss

// Cast mode constants (matches cast.move)
export const MODE_OPEN  = 0  // anyone can pay to read
export const MODE_SEALED = 1 // only recipient can read

// Cast duration constants (matches cast.move)
export const DUR_24H = 1
export const DUR_7D  = 4   // 7 days — default for DEDDROP drops

// Harbor / Vessel tier constants (matches harbor.move, vessel.move)
// Harbor TIER_1: costs $0.05 to open + $0.10 minimum balance = $0.15 total
export const HARBOR_TIER_1        = 1
export const HARBOR_TIER1_COST_BASE = 50_000n  // $0.05 tier fee
export const HARBOR_MIN_BALANCE    = 100_000n  // $0.10 minimum
export const HARBOR_TIER1_TOTAL    = 150_000n  // $0.15 minimum payment to harbor::open

// Vessel OPEN tier (can publish public casts)
export const VESSEL_TIER_OPEN = 2  // OPEN in vessel.move

// Default cast settings for DEDDROP drops
export const DROP_EXPIRY_DAYS = 7     // 7-day gated window (DUR_7D); post-expiry free-readable
