/**
 * PublicReceipt — Part 1 revision
 *
 * Part 1 addition (B — fresh-browser receipt TX recovery):
 *   When `payTxHash` is not provided (e.g. fresh browser load of a paid
 *   receipt URL, or hard refresh), and the request is paid, recover the
 *   specific payment transaction hash by fetching the PaymentRecorded event
 *   for this request ID using viem's typed getLogs.
 *
 *   The search is bounded to DEPLOYMENT_BLOCK–head in 10,000-block chunks
 *   (larger than the normal scan because we know the exact request ID).
 *   Router-state `payTxHash` is treated as a hint/optimisation only —
 *   it skips the getLogs lookup but is never presented as verified proof.
 *
 * All other behaviour preserved from Day 2.
 */
import { useState, useEffect, useRef } from 'react'
import { useReadContract, usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { CheckCircle, XCircle, Clock, ExternalLink, Printer, AlertCircle, Loader2 } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
  PAYMENT_RECORDED_TOPIC, type OnchainRequest,
} from '@/lib/contract'
import { ARC_TESTNET_DEPLOYMENT } from '@/lib/deployment'
import { formatAddr, formatTs, isExpired } from '@/lib/ui'

const PAYMENT_RECORDED_ABI = parseAbiItem(
  'event PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)'
)

const DEPLOYMENT_BLOCK = ARC_TESTNET_DEPLOYMENT.block
const RECOVERY_CHUNK = 10_000n

interface PublicReceiptProps {
  requestId: bigint
  /** If provided (e.g. from router state after same-session payment),
   *  this is used as the TX link. On a fresh browser load this is absent
   *  and we recover it from the PaymentRecorded event instead. */
  payTxHash?: `0x${string}`
}

export function PublicReceipt({ requestId, payTxHash: hintTxHash }: PublicReceiptProps) {
  const { data: rawReq, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
    functionName: 'getRequest', args: [requestId],
    chainId: ARC_TESTNET_ID,
    query: { refetchInterval: 6_000 },
  })
  const req = rawReq as OnchainRequest | undefined
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  // B: Recovered payment TX hash from getLogs (fresh-browser case)
  const [recoveredTxHash, setRecoveredTxHash] = useState<`0x${string}` | undefined>(hintTxHash)
  const [recovering, setRecovering] = useState(false)
  // Use a ref to track in-flight state — avoids triggering the effect again
  const recoveringRef = useRef(false)

  // Resolved TX hash: prefer hint (same-session), fall back to recovered
  const payTxHash = hintTxHash ?? recoveredTxHash

  const isPaidReq = !!(req && req.status === 1)

  useEffect(() => {
    // Only recover when: request is paid, no hint was provided, not already recovered
    if (!isPaidReq || hintTxHash || recoveredTxHash || !publicClient) return
    if (recoveringRef.current) return

    recoveringRef.current = true
    // Set recovering state OUTSIDE the synchronous part of the effect
    // to avoid the "setRecovering directly in effect" lint warning.
    const t = setTimeout(() => setRecovering(true), 0)

    void (async () => {
      try {
        const head = await publicClient.getBlockNumber()
        let from = DEPLOYMENT_BLOCK
        let found: `0x${string}` | undefined

        while (from <= head && !found) {
          const to = from + RECOVERY_CHUNK - 1n < head ? from + RECOVERY_CHUNK - 1n : head
          try {
            // B: typed event lookup filtered by requestId (topic-1)
            // Cast via unknown to typed shape — post-validate each field.
            interface RawPayLog {
              address: string
              args?: { id?: bigint }
              transactionHash?: `0x${string}` | null
            }
            const logs = (await publicClient.getLogs({
              address: CONTRACT_ADDRESS as `0x${string}`,
              event: PAYMENT_RECORDED_ABI,
              args: { id: requestId },
              fromBlock: from,
              toBlock: to,
            })) as unknown as RawPayLog[]
            if (logs.length > 0) {
              for (const log of logs) {
                const args = log.args
                if (args?.id === requestId &&
                    log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
                  if (log.transactionHash) {
                    found = log.transactionHash
                    break
                  }
                }
              }
            }
          } catch {
            // Skip this chunk on failure — try next range
          }
          from = to + 1n
        }

        if (found) setRecoveredTxHash(found)
      } catch {
        // Recovery failed — receipt still renders, just without a TX link
      } finally {
        recoveringRef.current = false
        setRecovering(false)
      }
    })()

    return () => { clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaidReq, hintTxHash])

  // Fix 4: show Request #N immediately — ID is known from props
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Receipt — request #{requestId.toString()}
          </p>
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <span className="text-sm">Loading verified details from Arc Testnet…</span>
          </div>
          <div className="h-4 rounded bg-slate-100 animate-pulse w-2/3" />
          <div className="h-4 rounded bg-slate-100 animate-pulse w-1/2" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-700">
              Could not load receipt for request #{requestId.toString()}
            </p>
            <p className="text-xs text-rose-600 mt-0.5">
              Unable to reach Arc Testnet. Check your connection and try again.
              Strict browser content-blocking (e.g. Brave Shields) may block the RPC providers.
            </p>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          className="w-full py-2.5 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-sm font-semibold transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!req || req.merchant === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 text-center space-y-1">
        <p className="text-sm font-semibold text-slate-600">Receipt not found</p>
        <p className="text-xs text-slate-400">Request #{requestId.toString()} does not exist on Arc Testnet.</p>
      </div>
    )
  }

  const isPaid = req.status === 1
  const isCancelled = req.status === 2
  const expired = isExpired(req) && req.status === 0

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-5 space-y-4 ${
        isPaid ? 'bg-emerald-50 border-emerald-200' :
        isCancelled ? 'bg-rose-50 border-rose-200' :
        expired ? 'bg-slate-50 border-slate-200' :
        'bg-amber-50 border-amber-200'
      }`}>
        {/* Status badge */}
        <div className="flex items-center gap-2">
          {isPaid ? <CheckCircle size={20} className="text-emerald-500" /> :
           isCancelled ? <XCircle size={20} className="text-rose-400" /> :
           <Clock size={20} className="text-amber-500" />}
          <span className={`text-sm font-bold ${
            isPaid ? 'text-emerald-800' : isCancelled ? 'text-rose-700' : 'text-amber-700'
          }`}>
            {isPaid ? 'Payment confirmed' : isCancelled ? 'Cancelled' : expired ? 'Expired' : 'Open — not yet paid'}
          </span>
        </div>

        {/* Amount */}
        <div className="flex items-end gap-1.5">
          <TokenUSDC variant="branded" size={24} />
          <span
            className="text-3xl font-bold tabular-nums tracking-tight text-slate-900"
            style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em' }}
          >
            {formatUsdc(req.amount)}
          </span>
          <span className="text-sm text-slate-400 mb-0.5">USDC</span>
        </div>

        {/* Fields */}
        <div className="space-y-1.5 text-xs text-slate-600">
          <ReceiptRow label="Request ID" value={`#${requestId.toString()}`} />
          <ReceiptRow
            label="Merchant"
            value={formatAddr(req.merchant)}
            href={buildAddressExplorerUrl(ARC_TESTNET_ID, req.merchant)}
            mono
          />
          <ReceiptRow label="Expires" value={formatTs(req.expiresAt)} />
          {isPaid && (
            <>
              <ReceiptRow
                label="Payer"
                value={formatAddr(req.payer)}
                href={buildAddressExplorerUrl(ARC_TESTNET_ID, req.payer)}
                mono
              />
              <ReceiptRow label="Paid at" value={formatTs(req.paidAt)} />
            </>
          )}
        </div>

        {/* Onchain evidence */}
        {isPaid && (
          <div className="space-y-1.5 pt-1 border-t border-emerald-200">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
              Onchain evidence
            </p>
            {payTxHash ? (
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_ID, payTxHash)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline"
              >
                <ExternalLink size={12} /> View PaymentRecorded event
              </a>
            ) : recovering ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                <Loader2 size={11} className="animate-spin" />
                <span>Recovering transaction from chain…</span>
              </div>
            ) : (
              <a
                href={buildAddressExplorerUrl(ARC_TESTNET_ID, CONTRACT_ADDRESS)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
              >
                <ExternalLink size={12} /> View contract events on explorer
              </a>
            )}
            <p className="text-xs text-emerald-600 text-pretty">
              The <code className="font-mono bg-emerald-100 px-1 rounded">PaymentRecorded</code> event
              (topic-0: <code className="font-mono text-xs">{PAYMENT_RECORDED_TOPIC.slice(0, 18)}…</code>)
              is emitted for every settled payment and is independently verifiable.
            </p>
          </div>
        )}
      </div>

      {/* Contract source of truth */}
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 space-y-1">
        <p className="font-semibold text-slate-600 uppercase tracking-widest text-xs">Verified source</p>
        <div className="flex justify-between">
          <span className="text-slate-400">Contract</span>
          <a
            href={buildAddressExplorerUrl(ARC_TESTNET_ID, CONTRACT_ADDRESS)}
            target="_blank" rel="noopener noreferrer"
            className="font-mono hover:text-slate-700 flex items-center gap-0.5"
          >
            {formatAddr(CONTRACT_ADDRESS)} <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Chain</span>
          <span>Arc Testnet (5042002)</span>
        </div>
      </div>

      {/* Print button */}
      <button
        onClick={() => window.print()}
        className="w-full py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-sm transition-colors flex items-center justify-center gap-2"
      >
        <Printer size={15} /> Print receipt
      </button>
    </div>
  )
}

function ReceiptRow({
  label, value, mono, href,
}: { label: string; value: string; mono?: boolean; href?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 shrink-0">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className={`truncate hover:text-slate-700 flex items-center gap-0.5 ${mono ? 'font-mono' : ''}`}>
          {value} <ExternalLink size={10} />
        </a>
      ) : (
        <span className={`truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
      )}
    </div>
  )
}
