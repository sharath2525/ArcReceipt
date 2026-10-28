/**
 * MerchantDashboard — Rev 4
 *
 * Changes vs Rev 3:
 *   - Pagination: reads total count first, then fetches all pages.
 *     Requests beyond page 1 (>20) are now visible. Newest requests
 *     shown first by sorting descending.
 *   - TX tracking persisted to sessionStorage keyed by
 *     chainId+contract+account+action. Restored on refresh without
 *     resubmitting.
 *   - Receipt polling pinned to chainId 5042002. Handles success,
 *     revert, timeout, and RPC failure separately. Checks
 *     receipt.status before showing "created" or "cancelled".
 *   - List states: loading skeleton / RPC error+retry / empty (no
 *     requests ever created) / populated. Previously loaded data
 *     stays visible during background refetch.
 *   - Cancel shows pending receipt rather than dismissing immediately
 *     on submission.
 *   - Amount/expiry frozen while TX is pending so the form displays
 *     what was submitted.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useReadContract, useReadContracts,
} from 'wagmi'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'

import {
  Copy, CheckCircle, ExternalLink, AlertCircle, QrCode, X,
  Loader2, ChevronDown, Receipt, RefreshCw,
} from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
  extractIdFromReceipt, buildPaymentLink, type OnchainRequest,
} from '@/lib/contract'
import { formatAddr, formatTs, statusMeta, isExpired } from '@/lib/ui'
import {
  savePendingTx, loadPendingTx, clearPendingTx,
} from '@/lib/pending-tx'
import { PublicReceipt } from './PublicReceipt'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Decode a wallet/contract error into a short user-friendly message. */
function decodeTxError(msg: string): string {
  if (/user rejected|User rejected|4001/i.test(msg)) return 'Rejected in wallet.'
  if (/insufficient funds|InsufficientFunds/i.test(msg)) return 'Insufficient balance for gas.'
  if (/ZeroAmount/i.test(msg)) return 'Amount must be greater than zero.'
  if (/ExpiryMustBeFuture/i.test(msg)) return 'Expiry must be in the future.'
  if (/ExpiryTooFar/i.test(msg)) return 'Expiry is too far ahead (max 30 days).'
  if (/RequestNotFound/i.test(msg)) return 'Request not found.'
  if (/RequestNotOpen/i.test(msg)) return 'Request is no longer open.'
  if (/RequestExpired/i.test(msg)) return 'Request has expired.'
  if (/NotMerchant/i.test(msg)) return 'Only the merchant can cancel this request.'
  if (/SelfPayment/i.test(msg)) return 'You cannot pay your own request.'
  if (/network changed|underlying network/i.test(msg)) return 'Network changed — please switch back to Arc Testnet.'
  if (/timeout|fetch failed|RPC/i.test(msg)) return 'Network error — check your connection and retry.'
  return msg.replace(/^[\w.]+Error:\s*/i, '').slice(0, 120)
}

const PAGE_SIZE = 20n

// ─── PendingBanner: shown while a submitted TX is being tracked ────────────

interface PendingBannerProps {
  hash: `0x${string}`
  status: 'pending' | 'success' | 'reverted' | 'timeout' | 'rpc-error'
  meta?: Record<string, string>
  onDismiss: () => void
}

function PendingBanner({ hash, status, meta, onDismiss }: PendingBannerProps) {
  const explorerUrl = buildTxExplorerUrl(ARC_TESTNET_ID, hash)
  const shortHash = `${hash.slice(0, 10)}…${hash.slice(-6)}`

  if (status === 'success') {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-500 shrink-0" />
            <p className="text-sm font-semibold text-emerald-800">Request created</p>
          </div>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
        {meta && (
          <p className="text-xs text-emerald-700">
            {meta.amount} USDC · expires in {meta.days}d
          </p>
        )}
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline">
          <ExternalLink size={11} /> {shortHash}
        </a>
      </div>
    )
  }

  if (status === 'reverted') {
    return (
      <div className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-red-500 shrink-0" />
            <p className="text-sm font-semibold text-red-800">Transaction reverted</p>
          </div>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
        <p className="text-xs text-red-600">The request was not created. Check explorer for details.</p>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline">
          <ExternalLink size={11} /> View on explorer
        </a>
      </div>
    )
  }

  if (status === 'timeout' || status === 'rpc-error') {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-800">
            {status === 'timeout' ? 'Confirmation timed out' : 'RPC error — cannot confirm'}
          </p>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
        <p className="text-xs text-amber-700">Transaction was submitted but confirmation could not be retrieved.</p>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-amber-700 hover:underline">
          <ExternalLink size={11} /> Check status: {shortHash}
        </a>
      </div>
    )
  }

  // pending
  return (
    <div className="rounded-2xl bg-slate-50 border border-[#CBD5E1] p-4 space-y-2 shadow-sm">
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-slate-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-700">Confirming…</p>
      </div>
      {meta && (
        <p className="text-xs text-slate-500">
          {meta.amount} USDC · expires in {meta.days}d
        </p>
      )}
      <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:underline">
        <ExternalLink size={11} /> {shortHash}
      </a>
    </div>
  )
}

// ─── RequestRow ───────────────────────────────────────────────────────────────

interface RequestRowProps {
  id: bigint
  req: OnchainRequest
  onCancel: (id: bigint) => void
  cancellingId: bigint | null
  cancelStatus: 'idle' | 'wallet' | 'confirming' | 'success' | 'reverted' | 'error'
  onShowQr?: (id: bigint) => void
}

function RequestRow({ id, req, onCancel, cancellingId, cancelStatus, onShowQr: _onShowQr }: RequestRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [showQr, setShowQr]     = useState(false)

  // H2 fix: use string comparison so restored cancellingId (parsed from meta)
  // matches the contract-read bigint reliably across all JS environments.
  const isThisCancelling = cancellingId !== null && cancellingId.toString() === id.toString()
  const meta    = statusMeta(req.status, req)
  const expired = isExpired(req) && req.status === 0
  const canCancel = req.status === 0 && !expired

  const link = buildPaymentLink(id)
  const copyLink = useCallback(() => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }, [link])

  // Determine displayed status — if this row is being cancelled, show in-progress
  const displayMeta = isThisCancelling
    ? (cancelStatus === 'confirming'
        ? { label: 'Cancelling…', color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' }
        : meta)
    : meta

  return (
    <div className="rounded-xl border border-[#CBD5E1] bg-white overflow-hidden shadow-sm hover:border-emerald-300 transition-colors">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-inset">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono text-slate-500 shrink-0">#{id.toString()}</span>
          <span className="font-semibold text-slate-800 text-sm">
            {formatUsdc(req.amount)} <span className="font-normal text-slate-500 text-xs">USDC</span>
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${displayMeta.color} ${displayMeta.bg}`}>
            {expired ? 'Expired' : displayMeta.label}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#CBD5E1] pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500">Merchant</span>
              <p className="font-mono text-slate-700 mt-0.5">{formatAddr(req.merchant)}</p>
            </div>
            <div>
              <span className="text-slate-500">Expires</span>
              <p className="text-slate-700 mt-0.5">{formatTs(req.expiresAt)}</p>
            </div>
            {req.status === 1 && (
              <>
                <div>
                  <span className="text-slate-500">Paid by</span>
                  <p className="font-mono text-slate-700 mt-0.5">{formatAddr(req.payer)}</p>
                </div>
                <div>
                  <span className="text-slate-500">Paid at</span>
                  <p className="text-slate-700 mt-0.5">{formatTs(req.paidAt)}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400">
              {copied ? <CheckCircle size={13} className="text-emerald-500" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={() => setShowQr(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400">
              <QrCode size={13} /> {showQr ? 'Hide QR' : 'Show QR'}
            </button>
            {canCancel && (
              <button
                onClick={() => onCancel(id)}
                disabled={isThisCancelling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-xs font-medium text-red-600 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400">
                {isThisCancelling ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                Cancel
              </button>
            )}
          </div>
          {showQr && (
            <div className="rounded-xl bg-white border border-[#CBD5E1] p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600">#{id.toString()} Payment QR</p>
              <div className="flex justify-center">
                <QRCodeSVG value={link} size={180} bgColor="#ffffff" fgColor="#0f172a" level="M" />
              </div>
              <p className="text-xs text-slate-400 text-center break-all">{link}</p>
              <a href={link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                <ExternalLink size={11} /> Open checkout link
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RequestRowWithData ───────────────────────────────────────────────────────

function matchesFilter(req: OnchainRequest, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (filter === 'open')      return req.status === 0 && req.expiresAt > now
  if (filter === 'paid')      return req.status === 1
  if (filter === 'expired')   return req.status === 0 && req.expiresAt <= now
  if (filter === 'cancelled') return req.status === 2
  return true
}

function RequestRowWithData({ id, onCancel, cancellingId, cancelStatus, statusFilter, onShowQr }: {
  id: bigint
  onCancel: (id: bigint) => void
  cancellingId: bigint | null
  cancelStatus: 'idle' | 'wallet' | 'confirming' | 'success' | 'reverted' | 'error'
  statusFilter: StatusFilter
  onShowQr?: (id: bigint) => void
}) {
  const { data: rawReq, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
    functionName: 'getRequest', args: [id],
    chainId: ARC_TESTNET_ID,
    // Stage 1 fix: staleTime reduced to 5 s so rows update promptly when
    // another browser pays this request. Combined with refetchInterval: 8_000
    // this ensures paid status propagates within ~5-8 s without overwhelming
    // the RPC when many rows are mounted.
    query: { staleTime: 5_000, refetchInterval: 8_000, refetchOnMount: true },
  })
  const req = rawReq as OnchainRequest | undefined

  if (isLoading) return <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />

  // Fix 5: show a proper error row with Retry instead of perpetual "loading…"
  if (error || (!req || req.merchant === '0x0000000000000000000000000000000000000000')) {
    return (
      <div className="h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-between px-4">
        <span className="text-xs text-rose-500">
          #{id.toString()} — {error ? 'RPC error' : 'not found'}
        </span>
        {error && (
          <button
            onClick={() => void refetch()}
            className="text-xs text-emerald-600 hover:underline font-medium flex items-center gap-1"
          >
            <RefreshCw size={11} /> Retry
          </button>
        )}
      </div>
    )
  }

  if (!matchesFilter(req, statusFilter)) return null

  return (
    <RequestRow
      id={id} req={req}
      onCancel={onCancel}
      cancellingId={cancellingId}
      cancelStatus={cancelStatus}
      onShowQr={onShowQr}
    />
  )
}

// ─── usePaginatedIds: fetches ALL request IDs using total + paged offsets ─────

function usePaginatedIds(address: `0x${string}` | undefined) {
  // Step 1: read total count with limit=0 (returns total, empty ids array)
  const { data: totalData, error: totalError, isLoading: loadingTotal, refetch: refetchTotal } =
    useReadContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests',
      args: address ? [address, 0n, 0n] : undefined,
      chainId: ARC_TESTNET_ID,
      query: { enabled: !!address, staleTime: 0, refetchInterval: 4_000 },
    })

  const total: bigint = totalData ? (totalData as [bigint[], bigint])[1] : 0n

  // Step 2: build page specs — how many pages of PAGE_SIZE do we need?
  const pageCount = total > 0n ? Number((total + PAGE_SIZE - 1n) / PAGE_SIZE) : 0

  const pageContracts = useMemo(() => {
    if (!address || pageCount === 0) return []
    return Array.from({ length: pageCount }, (_, i) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests' as const,
      args: [address, BigInt(i) * PAGE_SIZE, PAGE_SIZE] as [string, bigint, bigint],
      chainId: ARC_TESTNET_ID,
    }))
  }, [address, pageCount])

  const { data: pagesData, isLoading: loadingPages, error: pagesError, refetch: refetchPages } =
    useReadContracts({
      contracts: pageContracts,
      query: {
        enabled: pageContracts.length > 0,
        staleTime: 0,
        refetchInterval: 4_000,
      },
    })

  const allIds = useMemo(() => {
    if (!pagesData) return [] as bigint[]
    const ids: bigint[] = []
    for (const page of pagesData) {
      if (page.status === 'success') {
        const [pageIds] = page.result as [bigint[], bigint]
        ids.push(...pageIds)
      }
    }
    // Sort descending so newest (highest ID) is first
    return ids.slice().sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
  }, [pagesData])

  const isLoading = loadingTotal || (pageCount > 0 && loadingPages)
  const error = totalError ?? pagesError ?? null

  const refetch = useCallback(async () => {
    await refetchTotal()
    await refetchPages()
  }, [refetchTotal, refetchPages])

  return { allIds, total, isLoading, error, refetch }
}

type StatusFilter = 'all' | 'open' | 'paid' | 'expired' | 'cancelled'

// ─── MerchantDashboard ────────────────────────────────────────────────────────

// M2-E: mode='sell' is dead code — SellPage is used directly for selling.
// MerchantDashboard is now orders-only. The mode prop is kept for backward
// compatibility but 'sell' is no longer rendered. Default changed to 'orders'.
export function MerchantDashboard({
  onNavigateToOrder: _onNavigateToOrder,
}: {
  onNavigateToOrder?: (id: bigint) => void
}) {
  const { address } = useAccount()

  // ── Pending TX state — restored from sessionStorage on mount ────────────────
  const [createHash, setCreateHash] = useState<`0x${string}` | undefined>(() => {
    if (!address) return undefined
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'createRequest')
    return saved?.hash
  })
  const [createMeta, setCreateMeta] = useState<Record<string, string> | undefined>(() => {
    if (!address) return undefined
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
    return saved?.meta
  })
  const [createTxStatus, setCreateTxStatus] =
    useState<'pending' | 'success' | 'reverted' | 'timeout' | 'rpc-error'>('pending')
  const [showCreateBanner, setShowCreateBanner] = useState(!!createHash)

  // When account changes, restore any pending TXs for the new account
  useEffect(() => {
    if (!address) {
      setCreateHash(undefined); setCreateMeta(undefined); setShowCreateBanner(false)
      setCancellingId(null); setCancelHash(undefined); setCancelStatus('idle')
      return
    }
    const savedCreate = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'createRequest')
    if (savedCreate) {
      setCreateHash(savedCreate.hash); setCreateMeta(savedCreate.meta)
      setCreateTxStatus('pending'); setShowCreateBanner(true)
    } else {
      setCreateHash(undefined); setCreateMeta(undefined); setShowCreateBanner(false)
    }
    // H1: restore cancel state for new account
    const savedCancel = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
    if (savedCancel) {
      setCancelHash(savedCancel.hash)
      setCancelStatus('confirming')
      if (savedCancel.meta?.id) {
        try { setCancellingId(BigInt(savedCancel.meta.id)) } catch { /* ignore */ }
      }
    } else {
      setCancelHash(undefined); setCancelStatus('idle'); setCancellingId(null)
    }
  }, [address])

  // ── Create write hook (used only for dismiss/reset, not for submission) ──────
  const { reset: resetCreate } = useWriteContract()

  // ── Receipt polling pinned to Arc Testnet chain ID ─────────────────────────
  const {
    isLoading: isCreateConfirming,
    isError: isReceiptError,
    data: createReceipt,
  } = useWaitForTransactionReceipt({
    hash: createHash,
    chainId: ARC_TESTNET_ID,          // explicit chain pin
    pollingInterval: 1_500,
    confirmations: 1,                  // require at least 1 confirmation
    timeout: 60_000,                   // 60 s timeout
  })

  // Process receipt outcome exactly once per hash.
  //
  // Stage 1 fix: when the receipt is 'success' but extractIdFromReceipt returns
  // null (no RequestCreated event found), do NOT mark creation as successful.
  // This guards against replacement TXs that were mined without the intended
  // contract call. Show the explorer link and keep the pending banner so the
  // merchant can investigate instead of clearing tracking prematurely.
  const processedHash = useRef<string | null>(null)
  useEffect(() => {
    if (!createHash || !createReceipt || processedHash.current === createHash) return
    processedHash.current = createHash

    if (createReceipt.status === 'success') {
      const id = extractIdFromReceipt(createReceipt)
      if (id !== null) {
        // Confirmed: RequestCreated event found with a valid ID
        setCreateTxStatus('success')
        setCreateMeta(prev => prev ? { ...prev, id: id.toString() } : { id: id.toString() })
        toast.success(`Request #${id} created`)
        clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
        void refetch()
      } else {
        // TX succeeded but RequestCreated event absent — treat as unresolved.
        // Do NOT clear pending tracking. Show a timeout-like banner with explorer link.
        setCreateTxStatus('rpc-error')
        toast.error('TX confirmed but request event not found — check explorer')
        // Note: we intentionally do NOT set processedHash here so a later re-render
        // after a refetch that yields the correct receipt can still process it.
        processedHash.current = null
      }
    } else {
      // status === 'reverted'
      setCreateTxStatus('reverted')
      clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
      toast.error('Transaction reverted — request not created')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createReceipt, createHash])

  // Receipt error (RPC failure or timeout).
  // IMPORTANT: do NOT set processedHash.current here. A temporary RPC failure
  // must not permanently suppress recovery. If the receipt later arrives
  // (e.g. after the user retries or the RPC recovers), the success effect
  // above will still process it because processedHash.current is still null.
  useEffect(() => {
    if (!isReceiptError || !createHash) return
    // Only show the error banner if we have not already processed a success/revert
    if (processedHash.current === createHash) return
    setCreateTxStatus('rpc-error')
    toast.error('Could not confirm — check explorer for status')
  }, [isReceiptError, createHash])

  const handleCreateDismiss = useCallback(() => {
    resetCreate()
    setCreateHash(undefined)
    setCreateMeta(undefined)
    setShowCreateBanner(false)
    processedHash.current = null
    if (address) clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'createRequest')
  }, [resetCreate, address])

  // ── Status filter for Orders mode ─────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // ── Paginated request list ─────────────────────────────────────────────────
  const { allIds, total, isLoading: listLoading, error: listError, refetch } = usePaginatedIds(address)

  // Refetch when address changes
  useEffect(() => { void refetch() }, [address, refetch])

  // ── Cancel ─────────────────────────────────────────────────────────────────
  const { writeContract: doCancel, isPending: isCancelWallet } = useWriteContract()
  // H1 fix: restore cancellingId from pending-tx meta on mount so the per-row
  // "Cancelling…" indicator is visible after a page refresh.
  // H2 fix: compare cancellingId using toString() not === (bigint from meta is
  // parsed as string, bigint from contract read is a native bigint — === fails).
  const [cancellingId, setCancellingId] = useState<bigint | null>(() => {
    if (!address) return null
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
    if (saved?.meta?.id) {
      try { return BigInt(saved.meta.id) } catch { return null }
    }
    return null
  })
  const [cancelHash, setCancelHash] = useState<`0x${string}` | undefined>(() => {
    if (!address) return undefined
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
    return saved?.hash
  })
  const [cancelStatus, setCancelStatus] =
    useState<'idle' | 'wallet' | 'confirming' | 'success' | 'reverted' | 'error'>(() => {
      if (!address) return 'idle'
      const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
      return saved?.hash ? 'confirming' : 'idle'
    })

  const { data: cancelReceipt, isSuccess: cancelReceiptOk, isError: cancelReceiptErr } =
    useWaitForTransactionReceipt({
      hash: cancelHash,
      chainId: ARC_TESTNET_ID,
      pollingInterval: 1_500,
      confirmations: 1,
      timeout: 60_000,
    })

  useEffect(() => {
    if (!cancelHash || !cancelReceipt) return
    if (cancelReceiptOk) {
      if (cancelReceipt.status === 'success') {
        setCancelStatus('success')
        toast.success(`Request #${cancellingId} cancelled`)
        // Stage 1: clear persisted cancel tracking on confirmed success
        if (address) clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
        void refetch()
      } else {
        setCancelStatus('reverted')
        toast.error('Cancel transaction reverted')
        if (address) clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'cancelRequest')
      }
    }
    if (cancelReceiptErr) {
      setCancelStatus('error')
      toast.error('Could not confirm cancel — check explorer')
      // Do NOT clear on error — keep hash so user can check explorer
    }
  }, [cancelHash, cancelReceipt, cancelReceiptOk, cancelReceiptErr, cancellingId, refetch, address])

  const handleCancel = useCallback((id: bigint) => {
    if (cancelStatus === 'confirming' || isCancelWallet) return
    setCancellingId(id)
    setCancelStatus('wallet')
    doCancel(
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'cancelRequest', args: [id], chainId: ARC_TESTNET_ID },
      {
        onSuccess: (txHash) => {
          // Stage 1 fix: persist cancel hash so refresh restores tracking
          if (address) {
            savePendingTx({
              chainId: ARC_TESTNET_ID, contract: CONTRACT_ADDRESS,
              account: address, action: 'cancelRequest',
              hash: txHash, meta: { id: id.toString() },
            })
          }
          setCancelHash(txHash)
          setCancelStatus('confirming')
        },
        onError: (e) => {
          toast.error(decodeTxError(e.message))
          setCancelStatus('idle')
          setCancellingId(null)
        },
      }
    )
  }, [cancelStatus, isCancelWallet, doCancel, address])

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasRequests = allIds.length > 0

  const filterLabels: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'paid', label: 'Paid' },
    { key: 'expired', label: 'Expired' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div className="space-y-4">

      {/* Pending/result banner */}
      {showCreateBanner && createHash && (
        <PendingBanner
          hash={createHash}
          status={isCreateConfirming ? 'pending' : createTxStatus}
          meta={createMeta}
          onDismiss={handleCreateDismiss}
        />
      )}

      {/* Filter bar — orders mode */}
      {hasRequests && (
        <div className="flex gap-1.5 flex-wrap">
          {filterLabels.map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Request list */}
      <div className="space-y-2">
        {!address ? (
          <p className="text-sm text-slate-400 text-center py-6">
            Connect your wallet to see your requests.
          </p>
        ) : listLoading && !hasRequests ? (
          <div className="space-y-2">
            {([0,1,2] as const).map(i => (
              <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : listError && !hasRequests ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center space-y-2">
            <p className="text-sm text-red-700 font-medium">Could not load requests</p>
            <p className="text-xs text-red-500">{(listError as Error).message?.slice(0, 120)}</p>
            <button onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline font-medium">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : !hasRequests ? (
          <p className="text-sm text-slate-400 text-center py-6">
            No requests yet.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
                {total.toString()} Request{total !== 1n ? 's' : ''}
              </p>
              {listError && (
                <button onClick={() => void refetch()}
                  className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline">
                  <RefreshCw size={11} /> Retry
                </button>
              )}
            </div>
            {allIds.map(id => (
              <RequestRowWithData
                key={id.toString()} id={id}
                onCancel={handleCancel}
                cancellingId={cancellingId}
                cancelStatus={cancelStatus}
                statusFilter={statusFilter}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ─── VerifyPanel ──────────────────────────────────────────────────────────────

/** Standalone verify panel — enter any request ID to see its onchain receipt. */
export function VerifyPanel() {
  const [inputId, setInputId] = useState('')
  const [lookupId, setLookupId] = useState<bigint | null>(null)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#CBD5E1] bg-white p-4 space-y-3 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">Verify by request ID</p>
        <div className="flex gap-2">
          <input
            type="number" min="1" value={inputId}
            onChange={e => setInputId(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && inputId) {
                try { setLookupId(BigInt(inputId)) } catch { /* invalid */ }
              }
            }}
            placeholder="Request ID…"
            className="flex-1 px-3 py-2.5 rounded-xl border border-[#CBD5E1] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 placeholder:text-slate-400"
          />
          <button
            onClick={() => { try { setLookupId(BigInt(inputId)) } catch { /* invalid */ } }}
            disabled={!inputId}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center gap-1.5">
            <Receipt size={14} /> Verify
          </button>
        </div>
      </div>
      {lookupId !== null && <PublicReceipt requestId={lookupId} />}
    </div>
  )
}
