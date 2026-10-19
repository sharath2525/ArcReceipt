/**
 * deployment.ts — Verified deployment metadata for ArcReceiptCheckout.
 *
 * Single source of truth for deployment block, TX hash and timestamps.
 * Used by all scanner hooks. Never hardcode these values elsewhere.
 *
 * Verified against:
 *   contracts/contract-metadata/ArcReceiptCheckout.json
 *   AGENTS.md (deployment block 67,462,931)
 *   TX: 0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45
 *
 * Chain: Arc Testnet (5042002)
 */

import { ARC_TESTNET_ID } from '@/lib/contract'

export interface DeploymentRecord {
  chainId: number
  contractAddress: `0x${string}`
  txHash: `0x${string}`
  /** Block number confirmed from the deploy TX receipt and AGENTS.md. */
  block: bigint
  /** ISO 8601 timestamp of the deployment. */
  deployedAt: string
}

/**
 * Verified deployment record for ArcReceiptCheckout on Arc Testnet.
 *
 * Block 67,462,931 is confirmed from:
 *   - AGENTS.md: "Deployment block: 67,462,931"
 *   - contracts/contract-metadata/ArcReceiptCheckout.json (txHash matches)
 *   - Deployed 2026-10-16T07:21:04.299Z
 *
 * Do NOT scan before this block — no contract events exist before it.
 */
export const ARC_TESTNET_DEPLOYMENT: DeploymentRecord = {
  chainId: ARC_TESTNET_ID,
  contractAddress: '0x4017d948c7a8f370f5e8d0eee6da7be2859bea18',
  txHash: '0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45',
  block: 67_462_931n,
  deployedAt: '2026-10-16T07:21:04.299Z',
}

/**
 * Returns the deployment record for the given chain+contract pair, or null
 * if the chain is not supported. Always verify the returned record matches
 * the contract address in use before scanning.
 */
export function getDeploymentRecord(
  chainId: number,
  contractAddress: string
): DeploymentRecord | null {
  if (
    chainId === ARC_TESTNET_DEPLOYMENT.chainId &&
    contractAddress.toLowerCase() === ARC_TESTNET_DEPLOYMENT.contractAddress.toLowerCase()
  ) {
    return ARC_TESTNET_DEPLOYMENT
  }
  return null
}
