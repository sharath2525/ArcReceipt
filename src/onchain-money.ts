/**
 * onchain-money — self-contained USDC formatting helpers.
 * Replaces Arc Studio's injected @/onchain-money for production builds.
 *
 * USDC ERC-20 uses 6 decimal places.
 *   1.00 USDC  = 1_000_000  (raw units)
 *   0.000001   = 1          (smallest unit)
 */

const USDC_DECIMALS = 6
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS) // 1_000_000n

/**
 * Format a raw USDC bigint (6dp) as a human-readable string.
 * formatUsdc(1_000_000n) → "1.000000"
 * formatUsdc(10_000_000n) → "10.000000"
 */
export function formatUsdc(raw: bigint): string {
  const whole = raw / USDC_SCALE
  const frac = raw % USDC_SCALE
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0')
  return `${whole}.${fracStr}`
}

/**
 * Parse a human-readable USDC string into raw bigint units (6dp).
 * parseUsdc("10")        → 10_000_000n
 * parseUsdc("10.5")      → 10_500_000n
 * parseUsdc("0.000001")  → 1n
 * Throws on invalid input.
 */
export function parseUsdc(value: string): bigint {
  const str = value.trim()
  if (!str || isNaN(Number(str))) throw new Error(`Invalid USDC amount: ${str}`)
  const parts = str.split('.')
  if (parts.length > 2) throw new Error(`Invalid USDC amount: ${str}`)
  const [wholePart, fracPart = ''] = parts
  // Reject precision beyond 6 decimal places — USDC supports exactly 6 dp.
  // Silently truncating would change the submitted amount without the user's
  // knowledge, so we reject and require the caller to round before calling.
  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(
      `Too many decimal places: ${fracPart.length} (USDC supports at most ${USDC_DECIMALS})`
    )
  }
  const frac = fracPart.padEnd(USDC_DECIMALS, '0')
  return BigInt(wholePart) * USDC_SCALE + BigInt(frac)
}
