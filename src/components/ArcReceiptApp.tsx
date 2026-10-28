/**
 * ArcReceiptApp — v4 (routing fix)
 *
 * Fix 1: Replace the immutable `checkoutId` + fragile `tab` state with a
 * single `route` object. A single `navigate()` function updates both the
 * route state and the URL atomically so they can never diverge.
 *
 * Routes:
 *   /                         → view: sell
 *   ?view=orders              → view: orders       (ALWAYS MerchantDashboard)
 *   ?view=my-receipts         → view: my-receipts
 *   ?view=verify              → view: verify
 *   ?view=demo                → view: demo
 *   ?request=33               → view: checkout, requestId: 33n
 *   ?request=33&view=receipt  → view: receipt,   requestId: 33n
 *   ?request=33&view=order    → view: order,      requestId: 33n (merchant QR)
 *
 * Defects eliminated:
 *   - checkoutId was initialized once from the URL and never cleared.
 *     Clicking Sell then Orders would reopen checkout because checkoutId
 *     remained non-null. Now navigating to Orders clears requestId.
 *   - Tab and checkout ID were two separate pieces of state that could
 *     desync on refresh, back/forward, and programmatic navigation.
 *     Now there is one source of truth: `route`.
 *   - `window.location.search` was read only at init time. Browser
 *     back/forward now updates route via popstate.
 *   - Request IDs were validated through Number() before BigInt, which
 *     overflows for large IDs. Validation now uses BigInt directly.
 */
import { useState, useCallback, useEffect } from 'react'
import { ConnectKitButton } from 'connectkit'
import {
  Receipt, ShoppingBag, ClipboardList, FileText, Search, FlaskConical,
} from 'lucide-react'
import { SellPage }          from './SellPage'
import { MerchantDashboard } from './MerchantDashboard'
import { PublicCheckout }    from './PublicCheckout'
import { PublicReceipt }     from './PublicReceipt'
import { MyReceipts }        from './MyReceipts'
import { ABDemo }            from './ABDemo'
import { VerifyPanel }       from './MerchantDashboard'

// ── Route types ───────────────────────────────────────────────────────────────

type ViewName =
  | 'sell'
  | 'orders'
  | 'checkout'   // customer-facing: read-only preview + pay
  | 'receipt'    // wallet-free receipt after payment
  | 'order'      // merchant: reopen QR for an existing request
  | 'my-receipts'
  | 'verify'
  | 'demo'

interface Route {
  view: ViewName
  requestId: bigint | null        // present for checkout / receipt / order
  payTxHash?: `0x${string}`       // retained from payment for receipt explorer link
}

// ── Validate and parse a request ID string ────────────────────────────────────
// Uses BigInt directly — never Number() — to avoid uint256 overflow.

function parseRequestId(s: string | null): bigint | null {
  if (!s) return null
  try {
    const n = BigInt(s)
    if (n <= 0n) return null
    return n
  } catch {
    return null
  }
}

// ── Derive the initial route from the current URL ─────────────────────────────

function routeFromUrl(search: string): Route {
  const p = new URLSearchParams(search)
  const view = p.get('view')
  const requestId = parseRequestId(p.get('request'))

  if (requestId !== null) {
    if (view === 'receipt') return { view: 'receipt', requestId }
    if (view === 'order')   return { view: 'order',   requestId }
    return { view: 'checkout', requestId }
  }

  switch (view) {
    case 'orders':      return { view: 'orders',      requestId: null }
    case 'my-receipts': return { view: 'my-receipts', requestId: null }
    case 'verify':      return { view: 'verify',      requestId: null }
    case 'demo':        return { view: 'demo',         requestId: null }
    default:            return { view: 'sell',         requestId: null }
  }
}

// ── Serialize a route back to a URL search string ─────────────────────────────

function routeToSearch(route: Route): string {
  const p = new URLSearchParams()
  if (route.requestId !== null) {
    p.set('request', route.requestId.toString())
  }
  switch (route.view) {
    case 'sell':        break   // / with no params
    case 'orders':      p.set('view', 'orders'); break
    case 'checkout':    break   // ?request=N (no view param)
    case 'receipt':     p.set('view', 'receipt'); break
    case 'order':       p.set('view', 'order'); break
    case 'my-receipts': p.set('view', 'my-receipts'); break
    case 'verify':      p.set('view', 'verify'); break
    case 'demo':        p.set('view', 'demo'); break
  }
  const s = p.toString()
  return s ? '?' + s : ''
}

// ── Tab entries (the visible tab bar maps to a subset of views) ───────────────

type TabId = 'sell' | 'orders' | 'my-receipts' | 'verify' | 'demo'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'sell',        label: 'Sell',        icon: <ShoppingBag size={14} /> },
  { id: 'orders',      label: 'Orders',      icon: <ClipboardList size={14} /> },
  { id: 'my-receipts', label: 'My Receipts', icon: <FileText size={14} /> },
  { id: 'verify',      label: 'Verify',      icon: <Search size={14} /> },
  { id: 'demo',        label: 'Demo',        icon: <FlaskConical size={14} /> },
]

// Which tab is active for a given route?
function activeTab(view: ViewName): TabId | null {
  switch (view) {
    case 'sell':        return 'sell'
    case 'orders':
    case 'order':       return 'orders'
    case 'checkout':
    case 'receipt':     return null   // no tab highlighted for customer views
    case 'my-receipts': return 'my-receipts'
    case 'verify':      return 'verify'
    case 'demo':        return 'demo'
  }
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function ArcReceiptApp() {
  const [route, setRoute] = useState<Route>(() => routeFromUrl(window.location.search))

  // Listen for browser back/forward
  useEffect(() => {
    const onPop = () => setRoute(routeFromUrl(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Single navigation function — updates route state and URL atomically.
  const navigate = useCallback((next: Route) => {
    const search = routeToSearch(next)
    const url = window.location.pathname + search
    window.history.pushState({}, '', url)
    setRoute(next)
  }, [])

  // Tab bar click — always clears requestId so Orders can never show checkout
  const handleTabClick = useCallback((tabId: TabId) => {
    navigate({ view: tabId, requestId: null })
  }, [navigate])

  // Customer paid — navigate to receipt for the SAME request ID.
  // payTxHash is kept in route state (not the URL) so PublicReceipt can link
  // directly to the payment TX. It is supplementary — the receipt reads
  // authoritative state from the chain, not from this value.
  const handlePaid = useCallback((requestId: bigint, txHash: `0x${string}`) => {
    navigate({ view: 'receipt', requestId, payTxHash: txHash })
  }, [navigate])

  // After SellPage confirms creation, navigate to merchant order view
  const handleOrderCreated = useCallback((requestId: bigint) => {
    navigate({ view: 'order', requestId })
  }, [navigate])

  const currentTab = activeTab(route.view)

  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 flex flex-col">
      {/* Testnet banner */}
      <div className="w-full bg-amber-400 text-amber-900 text-center text-xs font-semibold py-1.5 px-4 tracking-wide">
        ⚠ TESTNET — Arc Testnet (chain 5042002) — No real funds
      </div>

      {/* Header */}
      <header className="px-4 pt-5 pb-3 flex items-center justify-between max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate({ view: 'sell', requestId: null })}
          className="flex items-center gap-2"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <Receipt size={16} className="text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-sm font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              ArcReceipt
            </h1>
            <p className="text-xs text-slate-400 leading-tight">Checkout on Arc Testnet</p>
          </div>
        </button>
        <ConnectKitButton />
      </header>

      {/* Tab bar */}
      <div className="max-w-2xl mx-auto w-full px-4 pb-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => handleTabClick(t.id)}
              className={`flex-1 min-w-fit py-2 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
                currentTab === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pb-8">

        {/* SELL — merchant food-stall point of sale */}
        {route.view === 'sell' && (
          <SellPage onOrderCreated={handleOrderCreated} />
        )}

        {/* ORDER — merchant reopens existing order QR (chain-sourced) */}
        {route.view === 'order' && route.requestId !== null && (
          <MerchantOrderView
            requestId={route.requestId}
            onBack={() => navigate({ view: 'orders', requestId: null })}
            onNavigate={navigate}
          />
        )}

        {/* ORDERS — ALWAYS merchant history; never replaced by checkout */}
        {route.view === 'orders' && (
          <MerchantDashboard onNavigateToOrder={(id) => navigate({ view: 'order', requestId: id })} />
        )}

        {/* CHECKOUT — customer-facing */}
        {route.view === 'checkout' && route.requestId !== null && (
          <PublicCheckout
            requestId={route.requestId}
            onPaid={(txHash) => handlePaid(route.requestId!, txHash)}
          />
        )}

        {/* RECEIPT — wallet-free, works from any browser */}
        {route.view === 'receipt' && route.requestId !== null && (
          <PublicReceipt requestId={route.requestId} payTxHash={route.payTxHash} />
        )}

        {/* MY RECEIPTS — payer history */}
        {route.view === 'my-receipts' && <MyReceipts />}

        {/* VERIFY — wallet-free receipt lookup */}
        {route.view === 'verify' && (
          <VerifyPanel />
        )}

        {/* DEMO */}
        {route.view === 'demo' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-700">
              <FlaskConical size={14} className="shrink-0 mt-0.5" />
              <span>
                <strong>Demo area</strong> — Creates testnet requests to demonstrate the A/B independence proof.
                Not for real transactions.
              </span>
            </div>
            <ABDemo />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-2xl mx-auto w-full px-4 pb-4 text-center">
        <p className="text-xs text-slate-300">Built with Arc Studio · Arc Testnet · Not audited</p>
      </footer>
    </div>
  )
}

// ── MerchantOrderView ─────────────────────────────────────────────────────────
// Reads request details from chain (not sessionStorage) and shows QR.
// Works from a fresh browser, without local order data.

import { useReadContract } from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle, AlertCircle, Loader2, ExternalLink, Copy, ArrowLeft,
  QrCode, ArrowRight,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
  buildPaymentLink, buildReceiptLink, type OnchainRequest,
} from '@/lib/contract'
import { formatUsdc } from '@/onchain-money'
import { formatAddr, formatTs, statusMeta, isExpired } from '@/lib/ui'

function MerchantOrderView({
  requestId, onBack, onNavigate,
}: {
  requestId: bigint
  onBack: () => void
  onNavigate: (r: Route) => void
}) {
  const [copied, setCopied] = useState(false)
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

  const expired = isExpired(req)
  const isPaid = req.status === 1
  const isCancelled = req.status === 2
  const meta = statusMeta(req.status, req)
  // isPaid must be checked before expired: a paid request that has since
  // passed its expiry timestamp should show "Paid", not "Expired".
  const statusLabel = isCancelled ? 'Cancelled' : isPaid ? 'Paid' : expired ? 'Expired' : meta.label

  return (
    <div className="space-y-4">
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

      {/* QR — always shown so merchant can reshare; encodes CUSTOMER checkout URL */}
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
          {isPaid && (
            <button
              onClick={() => onNavigate({ view: 'receipt', requestId })}
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
    </div>
  )
}
