/**
 * pending-tx.ts — sessionStorage-backed pending transaction tracker.
 *
 * Keyed by chainId + contractAddress + account + action so that switching
 * accounts or chains never shows a stale pending state from a different session.
 *
 * Stored per-action (one slot per action type). Does NOT auto-resubmit — it
 * only restores the hash so the UI can resume polling.
 */

export type PendingAction = 'createRequest' | 'cancelRequest' | 'pay'

export interface PendingTx {
  chainId: number
  contract: string   // lowercase
  account: string    // lowercase
  action: PendingAction
  hash: `0x${string}`
  /** Frozen inputs so the form can display what was submitted. */
  meta?: Record<string, string>
}

function key(chainId: number, contract: string, account: string, action: PendingAction): string {
  return `arc-receipt:pending:${chainId}:${contract.toLowerCase()}:${account.toLowerCase()}:${action}`
}

export function savePendingTx(tx: PendingTx): void {
  try {
    sessionStorage.setItem(key(tx.chainId, tx.contract, tx.account, tx.action), JSON.stringify(tx))
  } catch { /* storage full or private mode */ }
}

export function loadPendingTx(
  chainId: number, contract: string, account: string, action: PendingAction
): PendingTx | null {
  try {
    const raw = sessionStorage.getItem(key(chainId, contract, account, action))
    if (!raw) return null
    return JSON.parse(raw) as PendingTx
  } catch { return null }
}

export function clearPendingTx(
  chainId: number, contract: string, account: string, action: PendingAction
): void {
  try {
    sessionStorage.removeItem(key(chainId, contract, account, action))
  } catch { /* ignore */ }
}
