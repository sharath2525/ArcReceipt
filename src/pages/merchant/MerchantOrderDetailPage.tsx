/**
 * /merchant/orders/:requestId — Single order QR + detail view.
 * Reuses MerchantOrderView logic extracted from ArcReceiptApp.
 * Reads all data from chain — no sessionStorage dependency.
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useCallback, useEffect } from 'react'
import { useReadContract } from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Copy, QrCode, ArrowRight, RefreshCw, Maximize2, X,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
  buildPaymentLink, buildReceiptLink, type OnchainRequest,
} from '@/lib/contract'
import { formatUsdc } from '@/onchain-money'
import { formatAddr, formatTs, statusMeta, isExpired } from '@/lib/ui'

// ── PresentationMode — full-screen QR + amount for counter display ────────────

function PresentationMode({
  requestId, amount, paymentLink, isPaid, onClose,
}: {
  requestId: bigint
  amount: bigint
  paymentLink: string
  isPaid: boolean
  onClose: () => void
}) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-8 p-8 cursor-pointer"
      onClick={onClose}
      role="button"
      aria-label="Close presentation mode"
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label="Exit presentation mode"
      >
        <X size={20} />
      </button>

      {/* Status banner when paid */}
      {isPaid && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-emerald-100 text-emerald-700 px-4 py-2 rounded-full text-sm font-semibold">
          <CheckCircle size={16} /> Paid
        </div>
      )}

      {/* Amount */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-3">
          <TokenUSDC variant="branded" size={40} />
          <span
            className="text-6xl font-bold tabular-nums tracking-tight text-slate-900"
            style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.04em' }}
          >
            {formatUsdc(amount)}
          </span>
          <span className="text-2xl text-slate-400">USDC</span>
        </div>
        <p className="text-sm text-slate-400">Request #{requestId.toString()}</p>
      </div>

      {/* Large QR */}
      <div className="p-5 bg-white rounded-3xl border border-slate-100 shadow-lg">
        <QRCodeSVG value={paymentLink} size={280} bgColor="#ffffff" fgColor="#0f172a" level="M" />
      </div>

      <p className="text-sm text-slate-400">Customer scans to pay · Tap anywhere to close</p>
    </div>
  )
}

export default function MerchantOrderDetailPage() {
  const { requestId: rawId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()

  // Parse the request ID from URL
  let requestId: bigint | null = null
  try {
    if (rawId) {
      const n = BigInt(rawId)
      if (n > 0n) requestId = n
    }
  } catch { /* invalid */ }

  if (requestId === null) {
    return (
      <div className="space-y-3">
        <button onClick={() => void navigate('/merchant/orders')}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
          <ArrowLeft size={13} /> Back to Orders
        </button>
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-center">
          <p className="text-sm font-semibold text-rose-700">Invalid order ID</p>
        </div>
      </div>
    )
  }

  return <OrderDetailView requestId={requestId} onBack={() => void navigate('/merchant/orders')} />
}

function OrderDetailView({ requestId, onBack }: { requestId: bigint; onBack: () => void }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const [presentation, setPresentation] = useState(false)

  const { data: rawReq, isLoading, error, refetch } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
    functionName: 'getRequest', args: [requestId],
    chainId: ARC_TESTNET_ID,
    query: { refetchInterval: 5_000 },
  })
  const req = rawReq as OnchainRequest | undefined

  const paymentLink = buildPaymentLink(requestId)
  const receiptLink = buildReceiptLink(requestId)

  const copyLink = useCallback(() => {
    void navigator.clipboard.writeText(paymentLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }, [paymentLink])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
          <ArrowLeft size={13} /> Back to Orders
        </button>
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Order #{requestId.toString()}
          </p>
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <span className="text-sm">Loading verified details from Arc Testnet…</span>
          </div>
          <div className="h-4 rounded bg-slate-100 animate-pulse w-2/3" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
          <ArrowLeft size={13} /> Back to Orders
        </button>
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-700 font-medium">
              Could not load order #{requestId.toString()}
            </p>
          </div>
          <button onClick={() => void refetch()}
            className="w-full py-2.5 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-sm font-semibold">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!req || req.merchant === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
          <ArrowLeft size={13} /> Back to Orders
        </button>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 text-center">
          <p className="text-sm font-semibold text-slate-600">Order #{requestId.toString()} not found</p>
          <p className="text-xs text-slate-400 mt-1">This ID does not exist on Arc Testnet.</p>
        </div>
      </div>
    )
  }

  const isPaid = req.status === 1
  const isCancelled = req.status === 2
  // isPaid is checked before expired: a paid request whose original expiry
  // has since passed must show "Paid", not "Expired" (the contract records
  // the settled state permanently — expiry only prevents new payments).
  const expired = !isPaid && isExpired(req)
  const meta = statusMeta(req.status, req)
  const statusLabel = isCancelled ? 'Cancelled' : isPaid ? 'Paid' : expired ? 'Expired' : meta.label

  return (
    <div className="space-y-4">
      {/* Presentation mode overlay */}
      {presentation && (
        <PresentationMode
          requestId={requestId}
          amount={req.amount}
          paymentLink={paymentLink}
          isPaid={isPaid}
          onClose={() => setPresentation(false)}
        />
      )}

      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
        <ArrowLeft size={13} /> Back to Orders
      </button>

      {/* Order header */}
      <div className={`rounded-2xl border p-4 space-y-3 ${
        isPaid ? 'bg-emerald-50 border-emerald-200' :
        isCancelled || expired ? 'bg-slate-50 border-slate-200' :
        'bg-white border-slate-200'
      }`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Order #{requestId.toString()}
          </p>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color} ${meta.bg}`}>
            {statusLabel}
          </span>
        </div>
        <div className="flex items-end gap-1.5">
          <TokenUSDC variant="branded" size={24} />
          <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {formatUsdc(req.amount)}
          </span>
          <span className="text-base text-slate-400 mb-0.5">USDC</span>
        </div>
        <div className="space-y-1 text-xs text-slate-500">
          <div className="flex justify-between">
            <span className="text-slate-400">Merchant</span>
            <span className="font-mono">{formatAddr(req.merchant)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Expires</span>
            <span>{formatTs(req.expiresAt)}</span>
          </div>
          {isPaid && (
            <>
              <div className="flex justify-between">
                <span className="text-slate-400">Paid by</span>
                <span className="font-mono">{formatAddr(req.payer)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Paid at</span>
                <span>{formatTs(req.paidAt)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* QR — always shown so merchant can reshare */}
      {!isCancelled && (
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode size={16} className="text-emerald-600" />
            <p className="text-sm font-semibold text-slate-800">Payment QR</p>
            {isPaid && (
              <span className="text-xs text-emerald-600 font-medium">· Already paid</span>
            )}
          </div>
          <div className="flex justify-center">
            <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
              <QRCodeSVG value={paymentLink} size={200} bgColor="#ffffff" fgColor="#0f172a" level="M" />
            </div>
          </div>
          <p className="text-xs text-slate-400 text-center break-all">{paymentLink}</p>
          <div className="flex gap-2">
            <button onClick={copyLink}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700">
              {copied ? <CheckCircle size={14} className="text-emerald-500" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a href={paymentLink} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700">
              <ArrowRight size={14} /> Open checkout
            </a>
          </div>
          {/* Presentation mode — enlarge QR + amount for counter display */}
          {!isCancelled && !expired && (
            <button
              onClick={() => setPresentation(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
            >
              <Maximize2 size={14} /> Present order
            </button>
          )}
          {isPaid && (
            <button
              onClick={() => void navigate(`/receipt/${requestId.toString()}`)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-sm font-semibold text-emerald-700 border border-emerald-200">
              <ExternalLink size={14} /> Open receipt
            </button>
          )}
          <a href={receiptLink} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 py-1">
            <ExternalLink size={11} /> Shareable receipt link
          </a>
        </div>
      )}

      {/* Next order — navigates to Sell without cancelling this request */}
      <button
        onClick={() => void navigate('/merchant')}
        className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
      >
        <RefreshCw size={14} /> Next order
      </button>
      <p className="text-xs text-slate-400 text-center">
        Starts a new order. This request #{requestId.toString()} remains open on-chain.
      </p>
    </div>
  )
}
