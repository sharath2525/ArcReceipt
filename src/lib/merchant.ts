/**
 * merchant.ts — Merchant access configuration.
 *
 * VITE_MERCHANT_ADDRESS accepts one address OR a comma-separated list:
 *
 *   Single:   VITE_MERCHANT_ADDRESS=0xAbc...123
 *   Multiple: VITE_MERCHANT_ADDRESS=0xAbc...123,0xDef...456,0xGhi...789
 *
 * All addresses are treated equally — any of them unlocks the full merchant
 * workspace. This is public configuration (it becomes visible in the browser
 * bundle) — NOT a secret. It restricts the frontend workspace only; the
 * contract itself allows any wallet to create its own requests.
 *
 * To add or remove a merchant: update the env var in Vercel → redeploy.
 * No code change needed.
 *
 * Access states:
 *   'unconfigured' — env var missing or no valid addresses parsed
 *   'disconnected' — no wallet connected
 *   'authorized'   — connected wallet is in the configured set
 *   'unauthorized' — connected wallet is not in the configured set
 */

/** Parse and validate a comma-separated list of Ethereum addresses. */
function readMerchantAddresses(): `0x${string}`[] {
  const raw = import.meta.env.VITE_MERCHANT_ADDRESS as string | undefined
  if (!raw || !raw.trim()) return []
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(addr => /^0x[0-9a-f]{40}$/.test(addr)) as `0x${string}`[]
}

/**
 * All configured merchant addresses (lowercase).
 * Empty array means unconfigured.
 */
export const MERCHANT_ADDRESSES: `0x${string}`[] = readMerchantAddresses()

/**
 * First configured merchant address, for backward-compatible single-merchant
 * use (event scanner filter, order-detail guard, settings display).
 * null if unconfigured.
 */
export const MERCHANT_ADDRESS: `0x${string}` | null =
  MERCHANT_ADDRESSES.length > 0 ? MERCHANT_ADDRESSES[0] : null

export type MerchantAccess =
  | 'unconfigured'
  | 'disconnected'
  | 'authorized'
  | 'unauthorized'

/**
 * Derive the current merchant access state.
 * 'authorized' when the connected wallet matches ANY configured address.
 */
export function getMerchantAccess(
  connectedAddress: `0x${string}` | undefined
): MerchantAccess {
  if (MERCHANT_ADDRESSES.length === 0) return 'unconfigured'
  if (!connectedAddress) return 'disconnected'
  return MERCHANT_ADDRESSES.includes(connectedAddress.toLowerCase() as `0x${string}`)
    ? 'authorized'
    : 'unauthorized'
}

/**
 * Returns true when the connected wallet is any of the configured merchants.
 */
export function isMerchant(connectedAddress: `0x${string}` | undefined): boolean {
  return getMerchantAccess(connectedAddress) === 'authorized'
}

/**
 * Returns the configured merchant address that matches the given request
 * merchant, or null if none matches. Used to check whether a specific
 * onchain request belongs to one of the configured merchants.
 */
export function matchesMerchant(requestMerchant: string): boolean {
  return MERCHANT_ADDRESSES.includes(requestMerchant.toLowerCase() as `0x${string}`)
}
