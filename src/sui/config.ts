// CONK protocol addresses — update CONK_PACKAGE to v14 after prod deploy
export const CONK_PACKAGE    = import.meta.env.VITE_CONK_PACKAGE
  ?? '0x6eca0063f930674f26a4a4593a7ef5ed487e21f31caafe74290ab5df88478cc6' // v13 fallback
export const ABYSS_ID        = '0x075c8667d1780bdde01a8175cd458aa345b3f6e2a84c45b91f82b344a4325bd0'
export const DRIFT_ID        = '0x9312b6837bb12381849b413636064cd8d56b6ef84bf891b3f756b3cbb6157fad'
export const PROTOCOL_CONFIG = '0xdc8e5131d6e3bec492a2e12b1d7beddbfec709ae5def8e775dab59c7a45421ea'

export const SUI_RPC         = import.meta.env.VITE_SUI_RPC
  ?? 'https://conk-zkproxy-v2.italktonumbers.workers.dev/sui'
export const ZKPROXY_URL     = import.meta.env.VITE_ZKPROXY_URL
  ?? 'https://conk-zkproxy-v2.italktonumbers.workers.dev'
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

// USDC coin type on Sui mainnet
export const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
// USDC decimals
export const USDC_DECIMALS = 6

export const PROTOCOL_READ_FEE = 1000n // base units = $0.001 USDC

// Default cast settings for Locked Drop
export const DROP_EXPIRY_DAYS = 30    // 30 days gated; post-expiry free-readable (v14)
export const DROP_EXPIRY_MS   = DROP_EXPIRY_DAYS * 24 * 60 * 60 * 1000
