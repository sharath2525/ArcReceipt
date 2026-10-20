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
 * Trims trailing zeros beyond 2 decimal places minimum.
 *   formatUsdc(1_000_000n)  → "1.00"
 *   formatUsdc(1_500_000n)  → "1.50"
 *   formatUsdc(1_250_000n)  → "1.25"
 *   formatUsdc(1n)          → "0.000001"
 *   formatUsdc(10_000_000n) → "10.00"
 */
export function formatUsdc(raw: bigint): string {
  const whole = raw / USDC_SCALE
  const frac = raw % USDC_SCALE
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0')
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fracStr.replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${trimmed}`
}

/**
 * Parse a human-readable USDC string into raw bigint units (6dp).
 * parseUsdc("10")        → 10_000_000n
 * parseUsdc("10.5")      → 10_500_000n
 * parseUsdc("0.000001")  → 1n
 * Throws on invalid input.
 *
 * Strict rules (Part 1 hardening):
 *   - Only unsigned decimal notation accepted.
 *     Rejects: negatives ("-1"), hex ("0xff"), scientific notation ("1e6"),
 *     leading sign ("+1"), multiple dots, whitespace embedded in value.
 *   - At most 6 decimal places (USDC precision).
 *   - Whole part must be a non-negative decimal integer.
 *   - Result must be > 0 when used as a payment/cart total — callers that
 *     require a positive amount must check the return value themselves
 *     (parseUsdc("0") returns 0n without throwing — caller decides policy).
 */
export function parseUsdc(value: string): bigint {
  const str = value.trim()
  if (!str) throw new Error(`Invalid USDC amount: (empty)`)

  // Reject any character that is not a digit or a single decimal point.
  // This rejects: +, -, e, E, 0x/0X (hex), spaces embedded after trim.
  // Pattern: optional leading digits, optional dot + digits.
  if (!/^\d+(\.\d*)?$/.test(str)) {
    throw new Error(`Invalid USDC amount: ${str}`)
  }

  const parts = str.split('.')
  // At this point parts.length is 1 or 2 (the regex above ensures this).
  const [wholePart, fracPart = ''] = parts

  // Reject precision beyond 6 decimal places.
  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(
      `Too many decimal places: ${fracPart.length} (USDC supports at most ${USDC_DECIMALS})`
    )
  }

  const frac = fracPart.padEnd(USDC_DECIMALS, '0')

  // BigInt() on a clean decimal string is safe at this point.
  return BigInt(wholePart) * USDC_SCALE + BigInt(frac)
}
