/**
 * /merchant/today — Today dashboard (Part 3 revision).
 *
 * Part 3 additions:
 *   - Each stat card is clickable and opens a drill-down panel showing
 *     the underlying records (PaymentRecorded events, RequestCreated events,
 *     open awaiting requests, month collections).
 *   - ~ prefix on every incomplete value.
 *   - Scan completeness shown in card sub-labels and footer.
 *
 * Part 1/2 correctness preserved:
 *   - Awaiting uses useMerchantAllRequests (paginated getMerchantRequests).
 *   - isComplete only when scanMode=full AND head reached.
 *   - Rollover: 1-minute tick + visibilitychange.
 *   - Carried-over requests distinguished from today's.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays, ShoppingBag, RefreshCw, AlertTriangle,
  CheckCircle, Clock, TrendingUp, ArrowRight, Loader2,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useEventHistory } from '@/lib/use-event-history'
import { useMerchantAllRequests } from '@/lib/use-merchant-requests'
import {
  thisMonthUtcStart, isInUtcDay, isInUtcMonth,
  formatUtcDay, formatUtcMonth, nowSecs, sumBigInt,
  dayStartUtc,
} from '@/lib/utc-periods'
import { formatUsdc } from '@/onchain-money'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import { formatAddr } from '@/lib/ui'
import type { OnchainRequest } from '@/lib/contract'
import type { CreatedEvent, PaymentEvent } from '@/lib/use-event-history'

// ── UTC clock tick ─────────────────────────────────────────────────────────────

function useUtcNow(): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick(n => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return nowSecs()
}

// ── Time formatters ────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  return new Date(secs * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC'
}

function fmtDateShort(secs: number): string {
  return new Date(secs * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

// ── Stat card ─────────────────────────────────────────────────────────────────

type DrillKey = 'collected' | 'orders' | 'awaiting' | 'month'

function StatCard({
  id, label, value, sub, icon, highlight, incomplete,
  activeDrill, onToggle, children,
}: {
  id: DrillKey
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  highlight?: boolean
  incomplete?: boolean
  activeDrill: DrillKey | null
  onToggle: (k: DrillKey) => void
  children: React.ReactNode
}) {
  const expanded = activeDrill === id
  return (
    <div className={`rounded-2xl border overflow-hidden ${
      highlight ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
    }`}>
      <button
        onClick={() => onToggle(id)}
        className="w-full p-4 text-left hover:bg-black/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold tracking-widest uppercase text-slate-400">{label}</span>
          <div className="flex items-center gap-1">
            <span className={highlight ? 'text-emerald-500' : 'text-slate-300'}>{icon}</span>
            {expanded
              ? <ChevronUp size={12} className="text-slate-400" />
              : <ChevronDown size={12} className="text-slate-400" />}
          </div>
        </div>
        <div className="flex items-baseline gap-1">
          <span
            className={`text-2xl font-bold tabular-nums ${highlight ? 'text-emerald-800' : 'text-slate-900'}`}
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {value}
          </span>
          {incomplete && <span className="text-xs text-amber-500 font-semibold">~</span>}
        </div>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-1.5 max-h-72 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Drill-down rows ───────────────────────────────────────────────────────────

function PayDrillRow({ ev }: { ev: PaymentEvent }) {
  const nav = useNavigate()
  return (
    <div className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-emerald-50 border border-emerald-100 gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle size={11} className="text-emerald-500 shrink-0" />
        <span className="font-mono text-slate-400 shrink-0">#{ev.requestId.toString()}</span>
        <span className="font-semibold text-emerald-800">{formatUsdc(ev.amount)} USDC</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-slate-400">
        <span className="hidden sm:block">{formatAddr(ev.payer)}</span>
        <span>{fmtTime(ev.paidAt)}</span>
        <button onClick={() => void nav(`/receipt/${ev.requestId.toString()}`)}
          className="text-emerald-600 hover:underline font-medium">Receipt</button>
      </div>
    </div>
  )
}

function CreatedDrillRow({ ev }: { ev: CreatedEvent }) {
  const nav = useNavigate()
  return (
    <div className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-slate-50 border border-slate-100 gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-slate-400 shrink-0">#{ev.requestId.toString()}</span>
        <span className="font-semibold text-slate-700">{formatUsdc(ev.amount)} USDC</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 text-slate-400">
        <span>{fmtTime(ev.createdAt)}</span>
        <button onClick={() => void nav(`/merchant/orders/${ev.requestId.toString()}`)}
          className="text-slate-600 hover:underline font-medium">Order</button>
      </div>
    </div>
  )
}

function AwaitingDrillRow({ id, req, isCarriedOver }: {
  id: bigint; req: OnchainRequest; isCarriedOver: boolean
}) {
  const nav = useNavigate()
  return (
    <div className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-white border border-slate-100 gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-slate-400 shrink-0">#{id.toString()}</span>
        <span className="font-semibold text-slate-800">{formatUsdc(req.amount)} USDC</span>
        {isCarriedOver && (
          <span className="px-1 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-600 font-medium shrink-0">
            carried over
          </span>
        )}
      </div>
      <button
        onClick={() => void nav(`/merchant/orders/${id.toString()}`)}
        className="shrink-0 flex items-center gap-0.5 text-emerald-600 hover:text-emerald-700 font-medium"
      >
        QR <ArrowRight size={11} />
      </button>
    </div>
  )
}

function MonthDrillRow({ ev }: { ev: PaymentEvent }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-white border border-slate-100 gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-slate-400 shrink-0">#{ev.requestId.toString()}</span>
        <span className="font-semibold text-emerald-700">{formatUsdc(ev.amount)} USDC</span>
      </div>
      <span className="text-slate-400 shrink-0">
        {fmtDateShort(ev.paidAt)} {fmtTime(ev.paidAt)}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantTodayPage() {
  const navigate = useNavigate()
  const now = useUtcNow()

  const todayStart = dayStartUtc(now)
  const monthStart = thisMonthUtcStart()

  const merchant = MERCHANT_ADDRESS
  const { createdEvents, paymentEvents, scanProgress, isScanning, rescan } =
    useEventHistory(merchant)

  // ── UTC day/month derived metrics ──────────────────────────────────────────

  const todayCreated = useMemo(
    () => createdEvents.filter(e => isInUtcDay(e.createdAt, todayStart)),
    [createdEvents, todayStart]
  )

  const todayPayments = useMemo(
    () => paymentEvents.filter(e => isInUtcDay(e.paidAt, todayStart)),
    [paymentEvents, todayStart]
  )

  const thisMonthPayments = useMemo(
    () => paymentEvents.filter(e => isInUtcMonth(e.paidAt, monthStart)),
    [paymentEvents, monthStart]
  )

  const collectedToday = useMemo(
    () => sumBigInt(todayPayments.map(e => e.amount)),
    [todayPayments]
  )

  const collectedThisMonth = useMemo(
    () => sumBigInt(thisMonthPayments.map(e => e.amount)),
    [thisMonthPayments]
  )

  // ── A5: Live request state for "Awaiting payment" ─────────────────────────

  const { requestMap, failedStatusCount, isLoading: requestsLoading } =
    useMerchantAllRequests(merchant)

  const createdAtMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of createdEvents) map.set(ev.requestId.toString(), ev.createdAt)
    return map
  }, [createdEvents])

  const nowBigint = BigInt(now)
  const awaitingRequests = useMemo(() => {
    const result: { id: bigint; req: OnchainRequest; isCarriedOver: boolean }[] = []
    for (const [idStr, req] of requestMap.entries()) {
      if (req.status !== 0) continue
      if (req.expiresAt <= nowBigint) continue
      const id = BigInt(idStr)
      const createdAt = createdAtMap.get(idStr)
      const isCarriedOver = createdAt === undefined || !isInUtcDay(createdAt, todayStart)
      result.push({ id, req, isCarriedOver })
    }
    return result.sort((a, b) => {
      if (a.isCarriedOver !== b.isCarriedOver) return a.isCarriedOver ? 1 : -1
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
    })
  }, [requestMap, nowBigint, createdAtMap, todayStart])

  // ── Sorted helpers ─────────────────────────────────────────────────────────

  const sortedTodayPayments = useMemo(
    () => [...todayPayments].sort((a, b) => b.paidAt - a.paidAt),
    [todayPayments]
  )
  const sortedTodayCreated = useMemo(
    () => [...todayCreated].sort((a, b) => b.createdAt - a.createdAt),
    [todayCreated]
  )
  const sortedMonthPayments = useMemo(
    () => [...thisMonthPayments].sort((a, b) => b.paidAt - a.paidAt),
    [thisMonthPayments]
  )

  // ── Incomplete / scan status ───────────────────────────────────────────────
  const isIncomplete = !scanProgress.isComplete || scanProgress.failedRanges.length > 0
  const blocksRemaining = scanProgress.headBlock > scanProgress.scannedBlock
    ? scanProgress.headBlock - scanProgress.scannedBlock : 0n

  // ── Drill state ────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<DrillKey | null>(null)
  const toggleDrill = useCallback((k: DrillKey) => {
    setDrill(prev => prev === k ? null : k)
  }, [])

  // ── Stable rescan ref ──────────────────────────────────────────────────────
  const rescanRef = useRef(rescan)
  useEffect(() => { rescanRef.current = rescan }, [rescan])
  const handleRescan = useCallback(() => { rescanRef.current() }, [])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Today
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {formatUtcDay(todayStart)} · UTC
          </p>
        </div>
        <button
          onClick={() => void navigate('/merchant')}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
        >
          <ShoppingBag size={13} /> Sell
        </button>
      </div>

      {/* Scan status banner */}
      {(isScanning || isIncomplete) && (
        <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${
          !isScanning && scanProgress.failedRanges.length > 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="shrink-0 mt-0.5">
            {isScanning
              ? <Loader2 size={15} className="animate-spin text-slate-500" />
              : scanProgress.failedRanges.length > 0
                ? <AlertTriangle size={15} className="text-amber-500" />
                : <CheckCircle size={15} className="text-emerald-500" />}
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            {isScanning ? (
              <>
                <p className="text-xs font-semibold text-slate-700">Loading history — totals incomplete</p>
                <p className="text-xs text-slate-400">
                  Block {scanProgress.scannedBlock.toString()} of {scanProgress.headBlock.toString()} · {blocksRemaining.toString()} remaining
                </p>
              </>
            ) : scanProgress.failedRanges.length > 0 ? (
              <>
                <p className="text-xs font-semibold text-amber-700">
                  {scanProgress.failedRanges.length} range{scanProgress.failedRanges.length > 1 ? 's' : ''} failed — totals may be incomplete
                </p>
                <p className="text-xs text-amber-600">Failed ranges are not counted as zero.</p>
                <button onClick={handleRescan}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline mt-0.5">
                  <RefreshCw size={11} /> Rescan
                </button>
              </>
            ) : (
              <p className="text-xs font-semibold text-slate-600">
                History complete · block {scanProgress.headBlock.toString()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stats grid — each card is expandable */}
      <div className="grid grid-cols-2 gap-3">

        <StatCard
          id="collected"
          label="Collected today"
          value={formatUsdc(collectedToday)}
          sub={`${todayPayments.length} payment${todayPayments.length !== 1 ? 's' : ''} · USDC`}
          icon={<TrendingUp size={16} />}
          highlight={collectedToday > 0n}
          incomplete={isIncomplete}
          activeDrill={drill}
          onToggle={toggleDrill}
        >
          {sortedTodayPayments.length === 0
            ? <p className="text-xs text-slate-400 py-2 text-center">No confirmed payments today yet.</p>
            : sortedTodayPayments.map(ev => <PayDrillRow key={ev.key} ev={ev} />)}
        </StatCard>

        <StatCard
          id="orders"
          label="Orders today"
          value={todayCreated.length.toString()}
          sub="Created since midnight UTC"
          icon={<CalendarDays size={16} />}
          incomplete={isIncomplete}
          activeDrill={drill}
          onToggle={toggleDrill}
        >
          {sortedTodayCreated.length === 0
            ? <p className="text-xs text-slate-400 py-2 text-center">No orders created today yet.</p>
            : sortedTodayCreated.map(ev => <CreatedDrillRow key={ev.key} ev={ev} />)}
        </StatCard>

        <StatCard
          id="awaiting"
          label="Awaiting payment"
          value={requestsLoading ? '…' : awaitingRequests.length.toString()}
          sub={failedStatusCount > 0
            ? `${failedStatusCount} status read(s) failed`
            : 'Open, non-expired'}
          icon={<Clock size={16} />}
          incomplete={failedStatusCount > 0}
          activeDrill={drill}
          onToggle={toggleDrill}
        >
          {awaitingRequests.length === 0
            ? <p className="text-xs text-slate-400 py-2 text-center">No open requests awaiting payment.</p>
            : awaitingRequests.map(({ id, req, isCarriedOver }) => (
                <AwaitingDrillRow key={id.toString()} id={id} req={req} isCarriedOver={isCarriedOver} />
              ))}
        </StatCard>

        <StatCard
          id="month"
          label={formatUtcMonth(monthStart)}
          value={formatUsdc(collectedThisMonth)}
          sub="Collected this month · USDC"
          icon={<TokenUSDC variant="mono" size={16} />}
          incomplete={isIncomplete}
          activeDrill={drill}
          onToggle={toggleDrill}
        >
          {sortedMonthPayments.length === 0
            ? <p className="text-xs text-slate-400 py-2 text-center">No confirmed payments this month yet.</p>
            : sortedMonthPayments.map(ev => <MonthDrillRow key={ev.key} ev={ev} />)}
        </StatCard>

      </div>

      {/* ~ disclaimer */}
      {isIncomplete && (
        <p className="text-xs text-amber-600 text-center">
          ~ Values marked ~ are based on history scanned so far. Tap any card to see underlying records.
        </p>
      )}

      {/* Empty state — only when scan is complete */}
      {!isScanning && scanProgress.isComplete && awaitingRequests.length === 0 && todayPayments.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-3">
          <CalendarDays size={28} className="mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No activity today</p>
          <p className="text-xs text-slate-400">Start a sale to create your first order of the day.</p>
          <button
            onClick={() => void navigate('/merchant')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
          >
            <ShoppingBag size={14} /> Go to Sell
          </button>
        </div>
      )}

      {/* Data honesty footer */}
      <p className="text-xs text-slate-300 text-center">
        Collected = verified PaymentRecorded events · Created = RequestCreated block timestamps ·
        Local item labels are merchant notes only · Reporting timezone: UTC
      </p>

    </div>
  )
}
