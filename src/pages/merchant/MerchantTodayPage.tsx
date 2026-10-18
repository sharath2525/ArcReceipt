/**
 * /merchant/today — Today dashboard.
 *
 * Shows UTC daily and monthly summaries sourced from verified onchain events:
 *   - RequestCreated (creation time = event block timestamp)
 *   - PaymentRecorded (payment time = paidAt from log data, which equals block.timestamp)
 *
 * Reporting timezone: UTC. Midnight UTC = 05:30 IST.
 *
 * IMPORTANT HONESTY RULES:
 * - "Loading history — totals incomplete" shown until coverage reaches chain head.
 * - A failed event range is never silently zeroed — it triggers the incomplete warning.
 * - "Awaiting payment" counts only open, non-expired requests.
 * - paidAt from PaymentRecorded data (not block.timestamp of the scan block) is the
 *   authoritative payment timestamp for collections. These values match because the
 *   contract records block.timestamp as paidAt.
 * - Confirmed collected = count by paidAt inside the UTC day/month.
 * - Orders created = count by RequestCreated block.timestamp inside the UTC day.
 * - An order created yesterday and paid today: created count in yesterday, collected today.
 * - Unpaid requests are NOT revenue and are never added to collected amounts.
 * - Expired/cancelled requests do not appear in collections regardless of created date.
 *
 * Rollover handling:
 * - The component re-evaluates `today` on each render.
 * - A `useEffect` at 1-minute intervals ensures rollover while the tab is open.
 * - After a sleeping tab resumes (visibilitychange), a re-render is forced.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReadContracts } from 'wagmi'
import {
  CalendarDays, ShoppingBag, RefreshCw, AlertTriangle,
  CheckCircle, Clock, TrendingUp, ArrowRight, Loader2,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useEventHistory } from '@/lib/use-event-history'
import {
  thisMonthUtcStart, isInUtcDay, isInUtcMonth,
  formatUtcDay, formatUtcMonth, nowSecs, sumBigInt,
  dayStartUtc,
} from '@/lib/utc-periods'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
} from '@/lib/contract'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import { formatAddr, formatTs } from '@/lib/ui'
import type { OnchainRequest } from '@/lib/contract'

// ── UTC clock tick to handle rollover while tab is open ──────────────────────

function useUtcNow(): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick(n => n + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return nowSecs()
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, highlight, incomplete,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  highlight?: boolean
  incomplete?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-4 space-y-1.5 ${
      highlight ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest uppercase text-slate-400">{label}</span>
        <span className={highlight ? 'text-emerald-500' : 'text-slate-300'}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold tabular-nums ${highlight ? 'text-emerald-800' : 'text-slate-900'}`}
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {value}
        </span>
        {incomplete && (
          <span className="text-xs text-amber-500 font-medium">~</span>
        )}
      </div>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ── Awaiting list item ────────────────────────────────────────────────────────

function AwaitingRow({
  id, req, isCarriedOver,
}: {
  id: bigint
  req: OnchainRequest
  isCarriedOver: boolean
}) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white border border-slate-100 gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400 shrink-0">#{id.toString()}</span>
          <span className="text-sm font-semibold text-slate-800">{formatUsdc(req.amount)} USDC</span>
          {isCarriedOver && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-600 font-medium shrink-0">
              carried over
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">Expires {formatTs(req.expiresAt)}</p>
      </div>
      <button
        onClick={() => void navigate(`/merchant/orders/${id.toString()}`)}
        className="shrink-0 flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
      >
        QR <ArrowRight size={12} />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantTodayPage() {
  const navigate = useNavigate()
  const now = useUtcNow()

  const todayStart = dayStartUtc(now)
  const monthStart = thisMonthUtcStart()

  // Event history from chain
  const merchant = MERCHANT_ADDRESS
  const { createdEvents, paymentEvents, scanProgress, isScanning, rescan } =
    useEventHistory(merchant)

  // ── UTC day/month derived metrics ──────────────────────────────────────────

  const todayCreatedIds = useMemo(
    () => createdEvents.filter(e => isInUtcDay(e.createdAt, todayStart)).map(e => e.requestId),
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

  const collectedToday: bigint = useMemo(
    () => sumBigInt(todayPayments.map(e => e.amount)),
    [todayPayments]
  )

  const collectedThisMonth: bigint = useMemo(
    () => sumBigInt(thisMonthPayments.map(e => e.amount)),
    [thisMonthPayments]
  )

  // ── Live request state for "Awaiting payment" ──────────────────────────────
  // We fetch all merchant request IDs via getMerchantRequests, then read
  // statuses to find open + non-expired ones. We also need to know whether
  // each open request was created today or earlier.

  const allCreatedIds = useMemo(
    () => createdEvents.map(e => e.requestId),
    [createdEvents]
  )

  // Fetch request data for all known created IDs to check live status
  const requestContracts = useMemo(
    () => allCreatedIds.map(id => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getRequest' as const,
      args: [id] as [bigint],
      chainId: ARC_TESTNET_ID,
    })),
    [allCreatedIds]
  )

  const { data: requestsData } = useReadContracts({
    contracts: requestContracts,
    query: {
      enabled: requestContracts.length > 0,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  })

  // Build map: id → OnchainRequest
  const requestMap = useMemo(() => {
    const map = new Map<string, OnchainRequest>()
    if (!requestsData) return map
    requestsData.forEach((item, i) => {
      if (item.status === 'success' && item.result) {
        const req = item.result as OnchainRequest
        if (req.merchant !== '0x0000000000000000000000000000000000000000') {
          map.set(allCreatedIds[i].toString(), req)
        }
      }
    })
    return map
  }, [requestsData, allCreatedIds])

  // Awaiting payment = open status (0) AND not expired AND merchant matches
  const nowBigint = BigInt(now)
  const awaitingRequests = useMemo(() => {
    const result: { id: bigint; req: OnchainRequest; isCarriedOver: boolean }[] = []
    for (const ev of createdEvents) {
      const req = requestMap.get(ev.requestId.toString())
      if (!req) continue
      if (req.status !== 0) continue  // not open
      if (req.expiresAt <= nowBigint) continue  // expired
      const isCarriedOver = !isInUtcDay(ev.createdAt, todayStart)
      result.push({ id: ev.requestId, req, isCarriedOver })
    }
    // Sort: today's first, then carried over; within each group newest ID first
    return result.sort((a, b) => {
      if (a.isCarriedOver !== b.isCarriedOver) return a.isCarriedOver ? 1 : -1
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
    })
  }, [createdEvents, requestMap, nowBigint, todayStart])

  const awaitingToday = awaitingRequests.filter(r => !r.isCarriedOver)
  const awaitingCarriedOver = awaitingRequests.filter(r => r.isCarriedOver)

  // ── Recent paid today ──────────────────────────────────────────────────────
  const recentPaid = useMemo(
    () => [...todayPayments]
      .sort((a, b) => b.paidAt - a.paidAt)
      .slice(0, 5),
    [todayPayments]
  )

  // ── Incomplete / scan status ───────────────────────────────────────────────
  const isIncomplete = !scanProgress.isComplete || scanProgress.failedRanges.length > 0
  const blocksRemaining = scanProgress.headBlock > scanProgress.scannedBlock
    ? scanProgress.headBlock - scanProgress.scannedBlock
    : 0n

  const [showAll, setShowAll] = useState(false)
  const displayedAwaiting = showAll ? awaitingRequests : awaitingRequests.slice(0, 5)

  // ── Keep a stable rescan ref to avoid stale closure ──────────────────────
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
            {formatUtcDay(todayStart)} · Reporting timezone: UTC
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
          isIncomplete && !isScanning && scanProgress.failedRanges.length > 0
            ? 'bg-amber-50 border-amber-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="shrink-0 mt-0.5">
            {isScanning
              ? <Loader2 size={15} className="animate-spin text-slate-500" />
              : scanProgress.failedRanges.length > 0
                ? <AlertTriangle size={15} className="text-amber-500" />
                : <CheckCircle size={15} className="text-emerald-500" />
            }
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            {isScanning ? (
              <>
                <p className="text-xs font-semibold text-slate-700">Loading history — totals incomplete</p>
                <p className="text-xs text-slate-400">
                  Scanned to block {scanProgress.scannedBlock.toString()}{' '}
                  ({blocksRemaining.toString()} blocks remaining)
                </p>
              </>
            ) : scanProgress.failedRanges.length > 0 ? (
              <>
                <p className="text-xs font-semibold text-amber-700">
                  {scanProgress.failedRanges.length} range{scanProgress.failedRanges.length > 1 ? 's' : ''} failed — totals may be incomplete
                </p>
                <p className="text-xs text-amber-600">
                  Failed ranges are not counted as zero. Rescan to retry.
                </p>
                <button onClick={handleRescan}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline mt-0.5">
                  <RefreshCw size={11} /> Rescan
                </button>
              </>
            ) : (
              <p className="text-xs font-semibold text-slate-600">
                History up to date (block {scanProgress.headBlock.toString()})
              </p>
            )}
          </div>
        </div>
      )}

      {/* Today stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Collected today"
          value={formatUsdc(collectedToday)}
          sub={`${todayPayments.length} payment${todayPayments.length !== 1 ? 's' : ''} · USDC`}
          icon={<TrendingUp size={16} />}
          highlight={collectedToday > 0n}
          incomplete={isIncomplete}
        />
        <StatCard
          label="Orders today"
          value={todayCreatedIds.length.toString()}
          sub="Created since midnight UTC"
          icon={<CalendarDays size={16} />}
          incomplete={isIncomplete}
        />
        <StatCard
          label="Awaiting payment"
          value={awaitingRequests.length.toString()}
          sub="All open, non-expired requests"
          icon={<Clock size={16} />}
        />
        <StatCard
          label={`${formatUtcMonth(monthStart)}`}
          value={formatUsdc(collectedThisMonth)}
          sub="Collected this month · USDC"
          icon={<TokenUSDC variant="mono" size={16} />}
          incomplete={isIncomplete}
        />
      </div>

      {/* ~ disclaimer */}
      {isIncomplete && (
        <p className="text-xs text-amber-600 text-center">
          ~ Totals with ~ are based on history scanned so far. Refresh to update.
        </p>
      )}

      {/* Recent paid today */}
      {recentPaid.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
            Paid today
          </p>
          <div className="space-y-1.5">
            {recentPaid.map(ev => {
              const req = requestMap.get(ev.requestId.toString())
              return (
                <div key={ev.key}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-emerald-50 border border-emerald-100 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                    <span className="text-xs font-mono text-slate-400 shrink-0">#{ev.requestId.toString()}</span>
                    <span className="text-sm font-semibold text-emerald-800">
                      {formatUsdc(ev.amount)} USDC
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">{formatAddr(ev.payer)}</p>
                    {req && (
                      <button
                        onClick={() => void navigate(`/receipt/${ev.requestId.toString()}`)}
                        className="text-xs text-emerald-600 hover:underline"
                      >
                        Receipt →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Awaiting payment */}
      {awaitingRequests.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
            Awaiting payment ({awaitingRequests.length})
          </p>

          {awaitingToday.length > 0 && (
            <div className="space-y-1.5">
              {displayedAwaiting
                .filter(r => !r.isCarriedOver)
                .map(({ id, req }) => (
                  <AwaitingRow key={id.toString()} id={id} req={req} isCarriedOver={false} />
                ))}
            </div>
          )}

          {awaitingCarriedOver.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-medium">Carried over from earlier days</p>
              <div className="space-y-1.5">
                {displayedAwaiting
                  .filter(r => r.isCarriedOver)
                  .map(({ id, req }) => (
                    <AwaitingRow key={id.toString()} id={id} req={req} isCarriedOver={true} />
                  ))}
              </div>
            </div>
          )}

          {awaitingRequests.length > 5 && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="text-xs text-slate-500 hover:text-slate-700 font-medium"
            >
              {showAll ? 'Show less' : `Show all ${awaitingRequests.length}`}
            </button>
          )}
        </div>
      )}

      {/* Empty state — only when scan is complete */}
      {!isScanning && scanProgress.isComplete && awaitingRequests.length === 0 && todayPayments.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-3">
          <CalendarDays size={28} className="mx-auto text-slate-300" />
          <p className="text-sm font-semibold text-slate-600">No activity today</p>
          <p className="text-xs text-slate-400">
            Start a sale to create your first order of the day.
          </p>
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
        Collected = verified PaymentRecorded events · Creation = RequestCreated block timestamps ·
        Local item labels are merchant notes only · Reporting timezone: UTC
      </p>

    </div>
  )
}
