/**
 * onchain-facts — re-exports from contract.ts so all network values
 * come from a single env-var-driven source.
 *
 * Switch networks by changing env vars in Vercel — no code changes.
 *
 * buildTxExplorerUrl / buildAddressExplorerUrl accept an optional leading
 * chainId arg for backward compatibility with existing callers; it is ignored
 * because the explorer base URL is already set from the env var.
 */

export {
  CHAIN_ID,
  ARC_TESTNET_ID,
  EXPLORER_BASE,
  USDC_ADDRESS,
  IS_TESTNET,
  NETWORK_LABEL,
} from '@/lib/contract'

import {
  EXPLORER_BASE,
  USDC_ADDRESS,
  buildPaymentLink as _buildPaymentLink,
  buildReceiptLink as _buildReceiptLink,
} from '@/lib/contract'

export { _buildPaymentLink as buildPaymentLink, _buildReceiptLink as buildReceiptLink }

/** Build a block-explorer TX link.
 *  Accepts optional leading chainId for backward compatibility — ignored. */
export function buildTxExplorerUrl(_chainIdOrHash: number | string, txHashMaybe?: string): string {
  const txHash = txHashMaybe ?? (_chainIdOrHash as string)
  return `${EXPLORER_BASE}/tx/${txHash}`
}

/** Build a block-explorer address link.
 *  Accepts optional leading chainId for backward compatibility — ignored. */
export function buildAddressExplorerUrl(_chainIdOrAddress: number | string, addrMaybe?: string): string {
  const addr = addrMaybe ?? (_chainIdOrAddress as string)
  return `${EXPLORER_BASE}/address/${addr}`
}

/** USDC ERC-20 descriptor for the active chain. */
export function getUsdc(_chainId?: number) {
  return {
    address: USDC_ADDRESS,
    decimals: 6,
    symbol: 'USDC',
  }
}
