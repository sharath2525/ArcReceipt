/**
 * onchain-facts — self-contained replacements for Arc Studio's injected helpers.
 * These values are hardcoded for Arc Testnet (chainId 5042002).
 * No Arc Studio runtime dependency — works in any build environment.
 *
 * Arc Testnet facts (source: viem/chains arcTestnet + Arc docs):
 *   Chain ID:        5042002
 *   Explorer:        https://explorer.testnet.arc.io
 *   USDC ERC-20:     0x3600000000000000000000000000000000000000
 *   USDC decimals:   6  (ERC-20 view)
 *   Native decimals: 18 (gas view — same asset, different scale)
 */

export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_EXPLORER_BASE = 'https://explorer.testnet.arc.io'

/** Build a block-explorer TX link for Arc Testnet. */
export function buildTxExplorerUrl(_chainId: number, txHash: string): string {
  return `${ARC_EXPLORER_BASE}/tx/${txHash}`
}

/** Build a block-explorer address link for Arc Testnet. */
export function buildAddressExplorerUrl(_chainId: number, address: string): string {
  return `${ARC_EXPLORER_BASE}/address/${address}`
}

/** USDC ERC-20 descriptor for Arc Testnet. */
export function getUsdc(_chainId: number) {
  return {
    address: '0x3600000000000000000000000000000000000000' as `0x${string}`,
    decimals: 6,
    symbol: 'USDC',
  }
}
