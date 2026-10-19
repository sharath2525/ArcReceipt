/**
 * /merchant/reports — Historical daily/monthly reporting.
 *
 * Period picker: Today · Yesterday · This month · Last month · Custom range.
 * Within a month view: daily breakdown.
 * Expand a period row to see its underlying requests/payments.
 *
 * DATA HONESTY:
 * - "Loading history — totals incomplete" shown until scan is complete.
 * - Failed ranges shown with retry; never treated as zero.
 * - createdAt from RequestCreated block.timestamp (not expiry arithmetic).
 * - paidAt from PaymentRecorded log data (equals block.timestamp per contract).
 * - Expired and cancelled requests are visible in the created list but
 *   they are never added to collected amounts.
 * - Partial coverage is labelled with ~ prefix on all amounts.
 *
 * WHAT IS NOT SHOWN:
 * - End-of-day snapshots (we cannot reconstruct status at a past point in time).
 * - Cross-device item descriptions (local cart data is not onchain).
 * - Refund amounts (contract has no refund function).
 */
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, RefreshCw, AlertTriangle,
  CheckCircle, Loader2, Calendar,
} from 'lucide-react'
import { useEventHistory } from '@/lib/use-event-history'
import {
  thisMonthUtcStart, dayStartUtc, nextDayStartUtc,
  monthStartUtc, nextMonthStartUtc, daysInUtcMonth,
  formatUtcDay, formatUtcMonth,
  sumBigInt, nowSecs,
} from '@/lib/utc-periods'
import { formatUsdc } from '@/onchain-money'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import type { CreatedEvent, PaymentEvent, ScanMode } from '@/lib/use-event-history'

// ── Period types ──────────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'yesterday' | 'this-month' | 'last-month' | 'custom'

interface PeriodSpec {
  label: string
  key: PeriodKey
  fromSecs: number
  toSecs: number // exclusive
}

function buildPeriods(now: number): PeriodSpec[] {
  const todayStart = dayStartUtc(now)
  const yesterdayStart = dayStartUtc(now - 86400)
  const thisMonth = thisMonthUtcStart()
  const lastMonthStart = monthStartUtc(now - 86400 * 32) // safe lookback into prev month
  return [
    { key: 'today',      label: 'Today',      fromSecs: todayStart,      toSecs: nextDayStartUtc(now) },
    { key: 'yesterday',  label: 'Yesterday',  fromSecs: yesterdayStart,  toSecs: todayStart },
    { key: 'this-month', label: 'This month', fromSecs: thisMonth,       toSecs: nextMonthStartUtc(now) },
    { key: 'last-month', label: 'Last month', fromSecs: lastMonthStart,  toSecs: thisMonth },
    { key: 'custom',     label: 'Custom',     fromSecs: 0,               toSecs: 0 },
  ]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterCreated(events: CreatedEvent[], from: number, to: number) {
  return events.filter(e => e.createdAt >= from && e.createdAt < to)
}

function filterPaid(events: PaymentEvent[], from: number, to: number) {
  return events.filter(e => e.paidAt >= from && e.paidAt < to)
}

function fmtDate(secs: number): string {
  return new Date(secs * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
}

function fmtTime(secs: number): string {
  return new Date(secs * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

// ── Scan banner ───────────────────────────────────────────────────────────────

function ScanBanner({
  isScanning, scanProgress, scanMode, onRescan, onRescanFull,
}: {
  isScanning: boolean
  scanProgress: { scannedBlock: bigint; headBlock: bigint; isComplete: boolean; failedRanges: { fromBlock: bigint; toBlock: bigint; error: string }[] }
  scanMode: ScanMode
  onRescan: () => void
  onRescanFull: () => void
}) {
  const [showFullWarning, setShowFullWarning] = useState(false)

  if (!isScanning && scanProgress.isComplete && scanProgress.failedRanges.length === 0) {
    return (
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={13} className="text-emerald-500" />
          <span>
            {scanMode === 'recent' ? 'Recent history loaded' : 'Full history loaded'}
          </span>
        </div>
        {scanMode === 'recent' && !showFullWarning && (
          <button onClick={() => setShowFullWarning(true)}
            className="text-slate-400 hover:text-slate-600 underline">
            Load full history
          </button>
        )}
        {scanMode === 'recent' && showFullWarning && (
          <div className="flex items-center gap-2">
            <span className="text-amber-600">Scans ~65M blocks — may take a while.</span>
            <button onClick={() => { setShowFullWarning(false); onRescanFull() }}
              className="text-rose-600 font-medium hover:underline">Yes, scan all</button>
            <button onClick={() => setShowFullWarning(false)} className="hover:underline">Cancel</button>
          </div>
        )}
      </div>
    )
  }

  if (isScanning) {
    const pct = scanProgress.headBlock > 0n
      ? Math.min(100, Math.round(Number(
          (scanProgress.scannedBlock - (scanProgress.headBlock - (scanProgress.headBlock - scanProgress.scannedBlock + 1n))) * 100n
          / (scanProgress.headBlock - (scanProgress.headBlock - (scanProgress.headBlock - scanProgress.scannedBlock + 1n)) + 1n)
        )))
      : 0
    const blocksLeft = scanProgress.headBlock > scanProgress.scannedBlock
      ? scanProgress.headBlock - scanProgress.scannedBlock : 0n
    void pct
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center gap-2.5 text-xs text-slate-600">
        <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />
        <span className="flex-1">
          Scanning {scanMode === 'full' ? 'full' : 'recent'} history…{' '}
          <span className="text-slate-400">{blocksLeft.toString()} blocks remaining</span>
        </span>
      </div>
    )
  }

  // Failures
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-center gap-2.5 text-xs text-amber-700">
      <AlertTriangle size={13} className="text-amber-500 shrink-0" />
      <span className="flex-1">
        {scanProgress.failedRanges.length} range(s) failed to load — some totals may be missing.
      </span>
      <button onClick={onRescan}
        className="flex items-center gap-0.5 font-medium hover:underline">
        <RefreshCw size={11} /> Retry
      </button>
    </div>
  )
}

// ── Period summary row ────────────────────────────────────────────────────────

function PeriodRow({
  label, from, to, created, paid, incomplete, children,
}: {
  label: string
  from: number
  to: number
  created: CreatedEvent[]
  paid: PaymentEvent[]
  incomplete: boolean
  children?: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const collected = sumBigInt(paid.map(e => e.amount))
  const prefix = incomplete ? '~' : ''

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Calendar size={14} className="text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{label}</p>
            <p className="text-xs text-slate-400">
              {fmtDate(from)} – {fmtDate(to - 1)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs text-slate-400">Collected</p>
            <p className="text-sm font-bold text-emerald-700 tabular-nums">
              {prefix}{formatUsdc(collected)} USDC
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Created</p>
            <p className="text-sm font-semibold text-slate-700">{prefix}{created.length}</p>
          </div>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
          {children}

          {/* Payments */}
          {paid.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
                Payments ({paid.length})
              </p>
              <div className="space-y-1">
                {paid.map(ev => (
                  <div key={ev.key}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-400">#{ev.requestId.toString()}</span>
                      <span className="font-semibold text-emerald-800">{formatUsdc(ev.amount)} USDC</span>
                    </div>
                    <div className="text-right text-slate-400">
                      <p>{fmtDate(ev.paidAt)} {fmtTime(ev.paidAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Created */}
          {created.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
                Created orders ({created.length})
              </p>
              <div className="space-y-1">
                {[...created].sort((a, b) => b.createdAt - a.createdAt).map(ev => (
                  <div key={ev.key}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-400">#{ev.requestId.toString()}</span>
                      <span className="font-semibold text-slate-700">{formatUsdc(ev.amount)} USDC</span>
                    </div>
                    <div className="text-right text-slate-400">
                      <p>{fmtDate(ev.createdAt)} {fmtTime(ev.createdAt)} UTC</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {paid.length === 0 && created.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">No events in this period.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Daily breakdown (for month view) ─────────────────────────────────────────

function MonthlyBreakdown({
  monthStart, created, paid, incomplete,
}: {
  monthStart: number
  created: CreatedEvent[]
  paid: PaymentEvent[]
  incomplete: boolean
}) {
  const days = useMemo(() => daysInUtcMonth(monthStart), [monthStart])

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
        Daily breakdown
      </p>
      <div className="space-y-1">
        {days.map(dayStart => {
          const dayCreated = filterCreated(created, dayStart, dayStart + 86400)
          const dayPaid = filterPaid(paid, dayStart, dayStart + 86400)
          if (dayCreated.length === 0 && dayPaid.length === 0) return null
          const collected = sumBigInt(dayPaid.map(e => e.amount))
          const prefix = incomplete ? '~' : ''
          return (
            <div key={dayStart}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-100 text-xs">
              <span className="text-slate-600 font-medium">
                {new Date(dayStart * 1000).toLocaleDateString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
                })}
              </span>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <span className="text-slate-400">Created </span>
                  <span className="font-semibold text-slate-700">{prefix}{dayCreated.length}</span>
                </div>
                <div>
                  <span className="text-slate-400">Collected </span>
                  <span className="font-semibold text-emerald-700">{prefix}{formatUsdc(collected)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Custom range picker ───────────────────────────────────────────────────────

function CustomRangePicker({
  onApply,
}: {
  onApply: (from: number, to: number) => void
}) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState('')
  const [err, setErr]           = useState('')

  const apply = () => {
    setErr('')
    if (!fromDate || !toDate) { setErr('Select both dates.'); return }
    const fParts = fromDate.split('-').map(Number)
    const tParts = toDate.split('-').map(Number)
    const fSecs = Date.UTC(fParts[0], fParts[1] - 1, fParts[2]) / 1000
    const tSecs = Date.UTC(tParts[0], tParts[1] - 1, tParts[2]) / 1000 + 86400 // exclusive end
    if (fSecs >= tSecs) { setErr('From must be before To.'); return }
    onApply(fSecs, tSecs)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-600">Custom date range (UTC)</p>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-slate-400">From (UTC)</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-slate-400">To (UTC, inclusive)</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
      </div>
      {err && <p className="text-xs text-rose-500">{err}</p>}
      <button onClick={apply}
        className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
        Apply
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantReportsPage() {
  useNavigate() // kept for future navigation actions

  const merchant = MERCHANT_ADDRESS
  const { createdEvents, paymentEvents, scanProgress, isScanning, scanMode, rescan, rescanFull } =
    useEventHistory(merchant)

  const [activePeriod, setActivePeriod] = useState<PeriodKey>('this-month')
  const [customFrom, setCustomFrom] = useState(0)
  const [customTo, setCustomTo]     = useState(0)

  const now = nowSecs()
  const periods = useMemo(() => buildPeriods(now), [now])

  const activePeriodSpec = useMemo((): PeriodSpec | null => {
    if (activePeriod === 'custom') {
      if (!customFrom || !customTo) return null
      return { key: 'custom', label: 'Custom range', fromSecs: customFrom, toSecs: customTo }
    }
    return periods.find(p => p.key === activePeriod) ?? null
  }, [activePeriod, periods, customFrom, customTo])

  const activeCreated = useMemo(() =>
    activePeriodSpec ? filterCreated(createdEvents, activePeriodSpec.fromSecs, activePeriodSpec.toSecs) : [],
    [createdEvents, activePeriodSpec]
  )
  const activePaid = useMemo(() =>
    activePeriodSpec ? filterPaid(paymentEvents, activePeriodSpec.fromSecs, activePeriodSpec.toSecs) : [],
    [paymentEvents, activePeriodSpec]
  )

  const isIncomplete = !scanProgress.isComplete || scanProgress.failedRanges.length > 0

  const PERIOD_BUTTONS: { key: PeriodKey; label: string }[] = [
    { key: 'today',      label: 'Today' },
    { key: 'yesterday',  label: 'Yesterday' },
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'custom',     label: 'Custom' },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Reports
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Daily and monthly history · Reporting timezone: UTC</p>
      </div>

      {/* Scan status */}
      <ScanBanner
        isScanning={isScanning} scanProgress={scanProgress}
        scanMode={scanMode} onRescan={rescan} onRescanFull={rescanFull}
      />

      {/* Period picker */}
      <div className="flex gap-1.5 flex-wrap">
        {PERIOD_BUTTONS.map(({ key, label }) => (
          <button key={key} onClick={() => setActivePeriod(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activePeriod === key
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Custom range picker */}
      {activePeriod === 'custom' && (
        <CustomRangePicker onApply={(f, t) => { setCustomFrom(f); setCustomTo(t) }} />
      )}

      {/* Period content */}
      {activePeriodSpec && (activePeriod === 'this-month' || activePeriod === 'last-month') ? (
        <PeriodRow
          label={formatUtcMonth(activePeriodSpec.fromSecs)}
          from={activePeriodSpec.fromSecs}
          to={activePeriodSpec.toSecs}
          created={activeCreated}
          paid={activePaid}
          incomplete={isIncomplete}
        >
          <MonthlyBreakdown
            monthStart={activePeriodSpec.fromSecs}
            created={activeCreated}
            paid={activePaid}
            incomplete={isIncomplete}
          />
        </PeriodRow>
      ) : activePeriodSpec ? (
        <PeriodRow
          label={activePeriod === 'today'
            ? `Today — ${formatUtcDay(activePeriodSpec.fromSecs)}`
            : activePeriod === 'yesterday'
              ? `Yesterday — ${formatUtcDay(activePeriodSpec.fromSecs)}`
              : `${fmtDate(activePeriodSpec.fromSecs)} – ${fmtDate(activePeriodSpec.toSecs - 1)}`
          }
          from={activePeriodSpec.fromSecs}
          to={activePeriodSpec.toSecs}
          created={activeCreated}
          paid={activePaid}
          incomplete={isIncomplete}
        />
      ) : activePeriod === 'custom' ? (
        <p className="text-xs text-slate-400 text-center py-4">Select a date range above and click Apply.</p>
      ) : null}

      {/* Incomplete disclaimer */}
      {isIncomplete && (
        <p className="text-xs text-amber-600 text-center">
          ~ Amounts marked ~ are based on history scanned so far. Rescan to update.
        </p>
      )}

      {/* Data honesty footer */}
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-500">Data notes</p>
        <p>
          Creation dates come from <code className="font-mono bg-white px-1 rounded">RequestCreated</code> block timestamps.{' '}
          Payment dates come from <code className="font-mono bg-white px-1 rounded">PaymentRecorded</code> log data.
        </p>
        <p>
          Collected = confirmed USDC from paid requests only. Expired and cancelled requests are not revenue.
          An order created on day D and paid on day D+1 counts in D's Created and D+1's Collected.
        </p>
        <p>
          End-of-day status snapshots are not available — current status is shown alongside original dates.
          Local item descriptions are merchant notes only, not onchain.
        </p>
        {!scanProgress.isComplete && (
          <p className="text-amber-500 font-medium">
            Scan not complete — data covers blocks {(2_900_000n).toString()} –{' '}
            {scanProgress.scannedBlock.toString()} of {scanProgress.headBlock.toString()}.
          </p>
        )}
      </div>
    </div>
  )
}


