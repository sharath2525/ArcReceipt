/**
 * ABDemo — Day 2 (fixed)
 * Creates two equal-amount requests A then B. Pay B. Prove A stays Open.
 * Fixed bug: REQUEST_CREATED_TOPIC was wrong in previous version.
 * Correct topic-0 verified 2026-10-16 via keccak256("RequestCreated(uint256,address,uint256,uint256)")
 */
import { useMemo, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { toast } from 'sonner'
import { ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID, extractIdFromReceipt } from '@/lib/contract'
import { RequestCard } from './RequestCard'

export function ABDemo() {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const { writeContract: writeA, isPending: isPendingA, data: hashA } = useWriteContract()
  const { writeContract: writeB, isPending: isPendingB, data: hashB } = useWriteContract()

  const { isLoading: isConfirmingA, data: receiptA } = useWaitForTransactionReceipt({ hash: hashA, pollingInterval: 1_000, confirmations: 0 })
  const { isLoading: isConfirmingB, data: receiptB } = useWaitForTransactionReceipt({ hash: hashB, pollingInterval: 1_000, confirmations: 0 })

  // IDs derived from confirmed receipts via corrected topic-0
  const idA = useMemo(() => (receiptA ? extractIdFromReceipt(receiptA) : null), [receiptA])
  const idB = useMemo(() => (receiptB ? extractIdFromReceipt(receiptB) : null), [receiptB])

  const busyA = isPendingA || isConfirmingA
  const busyB = isPendingB || isConfirmingB

  const doCreate = useCallback((write: typeof writeA, busy: boolean) => {
    if (!address) { toast.error('Connect wallet first'); return }
    if (busy) return // hard guard — prevents double-click
    if (chainId !== ARC_TESTNET_ID) { switchChain({ chainId: ARC_TESTNET_ID }); return }
    write({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'createRequest',
      args: [parseUsdc('10'), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400)],
      chainId: ARC_TESTNET_ID,
    }, {
      onError: (e) => {
        const msg = /user rejected|4001/i.test(e.message)
          ? 'Request rejected in wallet.'
          : e.message.slice(0, 100)
        toast.error(msg)
      },
    })
  }, [address, chainId, switchChain])

  const createA = useCallback(() => doCreate(writeA, busyA), [doCreate, writeA, busyA])
  const createB = useCallback(() => doCreate(writeB, busyB), [doCreate, writeB, busyB])

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 text-pretty">
        Creates two identical 10 USDC requests (A then B) from your wallet. Pay B with a
        different wallet, then confirm A remains Open.
      </p>

      {/* Step 1 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase">
          Step 1 — Create Request A
        </p>
        {idA !== null ? (
          <RequestCard id={idA} label={`Request A  (#${idA.toString()})`} />
        ) : (
          <button onClick={createA} disabled={busyA || !address}
            className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            {isPendingA ? <><Loader2 size={14} className="animate-spin" /> Confirm in wallet…</> :
             isConfirmingA ? <><Loader2 size={14} className="animate-spin" /> Confirming A…</> :
             'Create Request A (10 USDC, 7 days)'}
          </button>
        )}
        {hashA && !idA && (
          <a href={buildTxExplorerUrl(ARC_TESTNET_ID, hashA)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <ExternalLink size={11} /> TX pending…
          </a>
        )}
      </div>

      {/* Step 2 — gated on A confirmed */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase">
          Step 2 — Create Request B
        </p>
        {idB !== null ? (
          <RequestCard id={idB} label={`Request B  (#${idB.toString()})`} />
        ) : (
          <button onClick={createB} disabled={busyB || idA === null || !address}
            className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            {isPendingB ? <><Loader2 size={14} className="animate-spin" /> Confirm in wallet…</> :
             isConfirmingB ? <><Loader2 size={14} className="animate-spin" /> Confirming B…</> :
             idA === null ? 'Waiting for Request A…' : 'Create Request B (10 USDC, 7 days)'}
          </button>
        )}
        {hashB && !idB && (
          <a href={buildTxExplorerUrl(ARC_TESTNET_ID, hashB)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <ExternalLink size={11} /> TX pending…
          </a>
        )}
      </div>

      {/* Instructions after both created */}
      {idA !== null && idB !== null && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Both requests created. Now pay B with a different wallet:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-pretty">
            <li>
              Connect customer wallet P — a wallet <strong>different</strong> from merchant M
            </li>
            <li>
              Click <strong>"Get test USDC"</strong> in the Arc Studio sidebar
              (faucet drips testnet USDC to P on Arc Testnet)
            </li>
            <li>
              Go to <strong>Checkout</strong> tab → enter ID{' '}
              <strong className="font-mono">{idB.toString()}</strong> (Request B)
            </li>
            <li>Approve 10 USDC (exact amount, not unlimited), then pay</li>
            <li>Return here — B card updates to Paid, A remains Open</li>
            <li>
              Attempt to pay B again — the contract returns{' '}
              <code className="bg-slate-100 px-1 rounded">RequestNotOpen</code>
            </li>
            <li>Use <strong>Verify</strong> tab to read A and B independently (no wallet needed)</li>
          </ol>
        </div>
      )}

      {/* Wallet simulation warning */}
      {(hashA || hashB) && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 flex items-start gap-2 text-xs text-amber-700">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span className="text-pretty">
            Your wallet may show "unsupported simulation" — Arc Testnet (5042002) is not on major
            wallet simulation lists. Each <code className="font-mono bg-amber-100 px-0.5 rounded">createRequest</code> call
            targets <code className="font-mono bg-amber-100 px-0.5 rounded">{CONTRACT_ADDRESS.slice(0, 10)}…</code>,
            sends no native value, and returns a request ID.
          </span>
        </div>
      )}
    </div>
  )
}
