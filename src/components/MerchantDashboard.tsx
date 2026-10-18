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
  useSwitchChain, useReadContract, useReadContracts,
} from 'wagmi'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { TokenUSDC } from '@web3icons/react'
import {
  Plus, Copy, CheckCircle, ExternalLink, AlertCircle, QrCode, X,
  Loader2, ChevronDown, Receipt, RefreshCw,
} from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUsdc, formatUsdc } from '@/onchain-money'
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
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
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

// ─── Expiry presets (§3.1: counter-friendly including 5m/15m/30m) ─────────────

interface ExpiryPreset { label: string; seconds: number }
const EXPIRY_PRESETS: ExpiryPreset[] = [
  { label: '5m',  seconds: 5 * 60 },
  { label: '15m', seconds: 15 * 60 },
  { label: '30m', seconds: 30 * 60 },
  { label: '1d',  seconds: 86_400 },
  { label: '3d',  seconds: 3 * 86_400 },
  { label: '30d', seconds: 30 * 86_400 },
]

// ─── CreateForm: purely presentational ────────────────────────────────────────

interface CreateFormProps {
  isWalletPending: boolean
  pendingMeta?: Record<string, string>   // frozen amount/days while pending
  onSubmit: (amount: string, expirySeconds: string) => void
}

function CreateForm({ isWalletPending, pendingMeta, onSubmit }: CreateFormProps) {
  const { address, chainId } = useAccount()
  const [amount, setAmount]       = useState(pendingMeta?.amount ?? '')
  const [expiryKey, setExpiryKey] = useState(pendingMeta?.expiryKey ?? '86400') // default 1d
  const [open, setOpen]           = useState(false)
  const [confirmed, setConfirmed] = useState(false)  // review-before-sign step

  // Freeze form to submitted values while TX is pending
  const frozen = isWalletPending && !!pendingMeta
  const isWrongChain = !!address && chainId !== ARC_TESTNET_ID
  const activeKey = frozen ? (pendingMeta?.expiryKey ?? expiryKey) : expiryKey
  const activePreset = EXPIRY_PRESETS.find(p => String(p.seconds) === activeKey) ?? EXPIRY_PRESETS[3]

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setConfirmed(false) }}
        className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
        <Plus size={16} /> New Request
      </button>
    )
  }

  // Review step — shown before wallet prompt (§3.1: review amount/merchant/network/expiry)
  if (confirmed && amount && !isWalletPending) {
    const amtNum = parseFloat(amount)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Review request</p>
          <button onClick={() => setConfirmed(false)} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400 text-xs">Amount</span>
            <span className="font-semibold text-slate-800">{isNaN(amtNum) ? amount : amtNum.toFixed(6)} USDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-xs">Expires in</span>
            <span className="text-slate-700">{activePreset.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-xs">Network</span>
            <span className="text-slate-700">Arc Testnet (5042002)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-xs">Merchant</span>
            <span className="font-mono text-slate-700 text-xs">{address ? `${address.slice(0,8)}…${address.slice(-6)}` : '—'}</span>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Creating a request requires a wallet transaction. The amount and expiry are stored
          onchain and cannot be changed after signing.
        </p>
        {isWrongChain ? (
          <button onClick={() => onSubmit(amount, activeKey)}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            <AlertCircle size={16} /> Switch to Arc Testnet to continue
          </button>
        ) : (
          <button
            onClick={() => onSubmit(amount, activeKey)}
            disabled={!address}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
          >
            Confirm &amp; sign in wallet
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">New payment request</p>
        <button onClick={() => { setOpen(false); setConfirmed(false) }} disabled={isWalletPending}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-30"><X size={16} /></button>
      </div>
      {/* Amount */}
      <div className="space-y-1">
        <label className="text-xs font-semibold tracking-widest uppercase text-slate-400">Amount (USDC)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2">
            <TokenUSDC variant="branded" size={18} />
          </span>
          <input type="number" min="0" step="0.000001"
            value={frozen ? (pendingMeta?.amount ?? amount) : amount}
            onChange={e => { if (!frozen) setAmount(e.target.value) }}
            readOnly={frozen}
            placeholder="0.00"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
      </div>
      {/* Expiry — counter-friendly presets per §3.1 */}
      <div className="space-y-1">
        <label className="text-xs font-semibold tracking-widest uppercase text-slate-400">Expires in</label>
        <div className="flex gap-1.5 flex-wrap">
          {EXPIRY_PRESETS.map(p => (
            <button key={p.seconds} onClick={() => { if (!frozen) setExpiryKey(String(p.seconds)) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeKey === String(p.seconds)
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              } ${frozen ? 'cursor-not-allowed' : ''}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isWalletPending ? (
        <button disabled
          className="w-full py-3 rounded-xl bg-slate-200 text-slate-500 font-semibold text-sm flex items-center justify-center gap-2 cursor-not-allowed">
          <Loader2 size={16} className="animate-spin" /> Waiting for wallet…
        </button>
      ) : (
        <button
          onClick={() => setConfirmed(true)}
          disabled={!address || !amount || parseFloat(amount) <= 0}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
        >
          Review &amp; create
        </button>
      )}
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

function RequestRow({ id, req, onCancel, cancellingId, cancelStatus, onShowQr }: RequestRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied]     = useState(false)
  const [showQr, setShowQr]     = useState(false)

  const isThisCancelling = cancellingId === id
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
    <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono text-slate-400 shrink-0">#{id.toString()}</span>
          <span className="font-semibold text-slate-800 text-sm">
            {formatUsdc(req.amount)} <span className="font-normal text-slate-400 text-xs">USDC</span>
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${displayMeta.color} ${displayMeta.bg}`}>
            {expired ? 'Expired' : displayMeta.label}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Merchant</span>
              <p className="font-mono text-slate-700 mt-0.5">{formatAddr(req.merchant)}</p>
            </div>
            <div>
              <span className="text-slate-400">Expires</span>
              <p className="text-slate-700 mt-0.5">{formatTs(req.expiresAt)}</p>
            </div>
            {req.status === 1 && (
              <>
                <div>
                  <span className="text-slate-400">Paid by</span>
                  <p className="font-mono text-slate-700 mt-0.5">{formatAddr(req.payer)}</p>
                </div>
                <div>
                  <span className="text-slate-400">Paid at</span>
                  <p className="text-slate-700 mt-0.5">{formatTs(req.paidAt)}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors">
              {copied ? <CheckCircle size={13} className="text-emerald-500" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button onClick={() => setShowQr(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 transition-colors">
              <QrCode size={13} /> {showQr ? 'Hide QR' : 'Show QR'}
            </button>
            {canCancel && (
              <button
                onClick={() => onCancel(id)}
                disabled={isThisCancelling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-xs font-medium text-red-600 transition-colors disabled:opacity-50">
                {isThisCancelling ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                Cancel
              </button>
            )}
          </div>
          {showQr && (
            <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-3">
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
    // No per-row polling — the paginated list refreshes every 4 s.
    // Individual rows use a long staleTime to avoid a polling storm with
    // many rows mounted simultaneously.
    query: { staleTime: 30_000, refetchOnMount: true },
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

export function MerchantDashboard({
  mode = 'sell',
  onNavigateToOrder,
}: {
  mode?: 'sell' | 'orders'
  /** Called when the user wants to view/share a specific order's QR. */
  onNavigateToOrder?: (id: bigint) => void
}) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

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

  // When account changes, restore any pending TX for the new account
  useEffect(() => {
    if (!address) { setCreateHash(undefined); setCreateMeta(undefined); setShowCreateBanner(false); return }
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'createRequest')
    if (saved) {
      setCreateHash(saved.hash)
      setCreateMeta(saved.meta)
      setCreateTxStatus('pending')
      setShowCreateBanner(true)
    } else {
      setCreateHash(undefined)
      setCreateMeta(undefined)
      setShowCreateBanner(false)
    }
  }, [address])

  // ── Create write hook ──────────────────────────────────────────────────────
  const { writeContract, isPending: isCreatePending, reset: resetCreate } = useWriteContract()

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

  // Process receipt outcome exactly once per hash
  const processedHash = useRef<string | null>(null)
  useEffect(() => {
    if (!createHash || !createReceipt || processedHash.current === createHash) return
    processedHash.current = createHash

    if (createReceipt.status === 'success') {
      setCreateTxStatus('success')
      const id = extractIdFromReceipt(createReceipt)
      if (id !== null) toast.success(`Request #${id} created`)
      clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
      void refetch()
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

  const handleCreateSubmit = useCallback((amount: string, expiryKey: string) => {
    if (!address) return
    if (chainId !== ARC_TESTNET_ID) { switchChain({ chainId: ARC_TESTNET_ID }); return }
    let parsed: bigint
    try { parsed = parseUsdc(amount) } catch { toast.error('Invalid amount'); return }
    if (parsed === 0n) { toast.error('Amount must be > 0'); return }
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(expiryKey))
    const meta = { amount, expiryKey }
    writeContract(
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'createRequest', args: [parsed, expiresAt], chainId: ARC_TESTNET_ID },
      {
        onSuccess: (txHash) => {
          savePendingTx({ chainId: ARC_TESTNET_ID, contract: CONTRACT_ADDRESS, account: address, action: 'createRequest', hash: txHash, meta })
          setCreateHash(txHash)
          setCreateMeta(meta)
          setCreateTxStatus('pending')
          setShowCreateBanner(true)
          processedHash.current = null
          toast.success('Submitted — confirming…')
        },
        onError: (e) => {
          const msg = /user rejected|4001/i.test(e.message) ? 'Rejected in wallet.' : 'Failed: ' + e.message.slice(0, 80)
          toast.error(msg)
        },
      }
    )
  }, [address, chainId, switchChain, writeContract])

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
  const [cancellingId, setCancellingId] = useState<bigint | null>(null)
  const [cancelHash, setCancelHash]     = useState<`0x${string}` | undefined>()
  const [cancelStatus, setCancelStatus] =
    useState<'idle' | 'wallet' | 'confirming' | 'success' | 'reverted' | 'error'>('idle')

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
        void refetch()
      } else {
        setCancelStatus('reverted')
        toast.error('Cancel transaction reverted')
      }
    }
    if (cancelReceiptErr) {
      setCancelStatus('error')
      toast.error('Could not confirm cancel — check explorer')
    }
  }, [cancelHash, cancelReceipt, cancelReceiptOk, cancelReceiptErr, cancellingId, refetch])

  const handleCancel = useCallback((id: bigint) => {
    if (cancelStatus === 'confirming' || isCancelWallet) return
    setCancellingId(id)
    setCancelStatus('wallet')
    doCancel(
      { address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'cancelRequest', args: [id], chainId: ARC_TESTNET_ID },
      {
        onSuccess: (txHash) => {
          setCancelHash(txHash)
          setCancelStatus('confirming')
        },
        onError: (e) => {
          const msg = /user rejected|4001/i.test(e.message) ? 'Rejected.' : e.message.slice(0, 80)
          toast.error(msg)
          setCancelStatus('idle')
          setCancellingId(null)
        },
      }
    )
  }, [cancelStatus, isCancelWallet, doCancel])

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

      {/* SELL mode: show create form */}
      {mode === 'sell' && (!showCreateBanner || (!isCreateConfirming && !isCreatePending)) && (
        <CreateForm
          isWalletPending={isCreatePending}
          pendingMeta={isCreatePending ? createMeta : undefined}
          onSubmit={handleCreateSubmit}
        />
      )}

      {/* ORDERS mode: filter bar */}
      {mode === 'orders' && hasRequests && (
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
            {mode === 'sell' ? 'No requests yet. Create your first above.' : 'No requests yet.'}
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
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
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
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
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
