/**
 * merchant.ts — Merchant access configuration.
 *
 * The authorized merchant wallet address is read from VITE_MERCHANT_ADDRESS
 * in the build environment. This is public configuration (it becomes visible
 * in the browser bundle) — NOT a secret. It restricts the frontend workspace
 * only; the contract itself still allows any wallet to create its own requests.
 *
 * Access states:
 *   'unconfigured' — env var missing or not a valid address
 *   'disconnected' — no wallet connected
 *   'authorized'   — connected wallet matches the configured address
 *   'unauthorized' — connected wallet does not match
 */

/** The configured merchant address (lowercase), or null if unconfigured. */
function readMerchantAddress(): `0x${string}` | null {
  const raw = import.meta.env.VITE_MERCHANT_ADDRESS as string | undefined
  if (!raw || !raw.trim()) return null
  const addr = raw.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return null
  return addr as `0x${string}`
}

export const MERCHANT_ADDRESS: `0x${string}` | null = readMerchantAddress()

export type MerchantAccess =
  | 'unconfigured'
  | 'disconnected'
  | 'authorized'
  | 'unauthorized'

/**
 * Derive the current merchant access state.
 * Call on every render — re-evaluates on account/chain change.
 */
export function getMerchantAccess(
  connectedAddress: `0x${string}` | undefined
): MerchantAccess {
  if (!MERCHANT_ADDRESS) return 'unconfigured'
  if (!connectedAddress) return 'disconnected'
  return connectedAddress.toLowerCase() === MERCHANT_ADDRESS.toLowerCase()
    ? 'authorized'
    : 'unauthorized'
}

/**
 * Returns true only when the connected wallet is the configured merchant.
 * Use as a guard before any merchant write action — do NOT rely on route
 * alone, since direct URL navigation bypasses route guards.
 */
export function isMerchant(connectedAddress: `0x${string}` | undefined): boolean {
  return getMerchantAccess(connectedAddress) === 'authorized'
}
