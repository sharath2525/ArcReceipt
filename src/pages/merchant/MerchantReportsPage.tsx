/**
 * /merchant/reports — Historical daily/monthly reporting (Part 3 revision).
 *
 * Part 3 additions:
 *   A. Period picker: Today / Yesterday / This month / Last month / Custom UTC range.
 *   B. Summary: confirmed USDC collected, payment count, requests created.
 *      Zero shown only after coverage is complete; ~ prefix otherwise.
 *   C. Daily collection chart (bar chart via SVG — no chart library needed).
 *   D. Detailed records table:
 *        - Request ID, creation date, payment date (when paid), exact amount,
 *          payer address, current verified status, receipt link, explorer link.
 *        - Date filter: creation date OR payment date (explicitly labelled).
 *        - Request-ID search.
 *        - Status filter.
 *        - Working pagination (10 rows per page).
 *        - Expandable/clickable daily rows.
 *   E. Export CSV: completeness guard (block if incomplete, require labelled
 *      partial override); correct escaping inc. formula-prefix sanitisation.
 *   F. Print summary: print-only layout with all data fields and completeness note.
 *
 * DATA HONESTY (preserved from earlier parts):
 *   - createdAt from RequestCreated block.timestamp.
 *   - paidAt from PaymentRecorded log data.
 *   - Expired/cancelled requests visible in created list, NOT in collected.
 *   - Failed ranges shown with retry, never zeroed.
 *   - End-of-day snapshots not available — current verified status shown.
 *   - Local item descriptions are not onchain and are not included in exports.
 */

import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronUp, RefreshCw, AlertTriangle,
  CheckCircle, Loader2, Calendar, Search, Download,
  Printer, ExternalLink, ArrowLeft, ArrowRight,
} from 'lucide-react'
import { useEventHistory } from '@/lib/use-event-history'
import { useMerchantAllRequests } from '@/lib/use-merchant-requests'
import { ARC_TESTNET_DEPLOYMENT } from '@/lib/deployment'
import {
  thisMonthUtcStart, dayStartUtc, nextDayStartUtc,
  nextMonthStartUtc, previousMonthStart,
  daysInUtcMonth,
  formatUtcDay, formatUtcMonth, sumBigInt, nowSecs,
} from '@/lib/utc-periods'
import { formatUsdc } from '@/onchain-money'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import {
  CONTRACT_ADDRESS,
  buildReceiptLink,
} from '@/lib/contract'
import { ARC_EXPLORER_BASE } from '@/onchain-facts'
import type { CreatedEvent, PaymentEvent, ScanMode } from '@/lib/use-event-history'
import type { OnchainRequest } from '@/lib/contract'

// ── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10
const EXPLORER_BASE = ARC_EXPLORER_BASE

// ── Period types ──────────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'yesterday' | 'this-month' | 'last-month' | 'custom'
type DateFilter = 'payment' | 'creation'
type StatusFilter = 'all' | 'paid' | 'open' | 'expired' | 'cancelled'

interface PeriodSpec {
  label: string
  key: PeriodKey
  fromSecs: number
  toSecs: number
}

function buildPeriods(now: number): PeriodSpec[] {
  const todayStart = dayStartUtc(now)
  const yesterdayStart = dayStartUtc(now - 86400)
  const thisMonth = thisMonthUtcStart()
  // D11 FIX: use previousMonthStart(now) — correct for all months including
  // January (monthStartUtc(now - 32 days) gave August when called on Oct 1).
  const lastMonthStart = previousMonthStart(now)
  return [
    { key: 'today',      label: 'Today',      fromSecs: todayStart,     toSecs: nextDayStartUtc(now) },
    { key: 'yesterday',  label: 'Yesterday',  fromSecs: yesterdayStart, toSecs: todayStart },
    { key: 'this-month', label: 'This month', fromSecs: thisMonth,      toSecs: nextMonthStartUtc(now) },
    { key: 'last-month', label: 'Last month', fromSecs: lastMonthStart, toSecs: thisMonth },
    { key: 'custom',     label: 'Custom',     fromSecs: 0,              toSecs: 0 },
  ]
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

/** Escape a CSV field: wrap in quotes, double internal quotes.
 *  Sanitise formula-injection prefixes (=, +, -, @, \t, \r). */
function csvField(value: string): string {
  // Sanitise spreadsheet formula prefixes
  const sanitised = value.replace(/^[=+\-@\t\r]/, "'$&")
  return `"${sanitised.replace(/"/g, '""')}"`
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',')
}

// ── Date formatters ────────────────────────────────────────────────────────────

function fmtUtcFull(secs: number): string {
  return new Date(secs * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC'
}

function fmtUtcDate(secs: number): string {
  return new Date(secs * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
}

function fmtUtcTime(secs: number): string {
  return new Date(secs * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

function isoUtc(): string {
  return new Date().toISOString()
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function requestStatus(req: OnchainRequest | undefined, now: number): string {
  if (!req) return 'Unknown'
  if (req.status === 1) return 'Paid'
  if (req.status === 2) return 'Cancelled'
  if (req.expiresAt <= BigInt(now)) return 'Expired'
  return 'Open'
}

function statusBadge(status: string): string {
  switch (status) {
    case 'Paid':      return 'bg-emerald-50 border-emerald-200 text-emerald-700'
    case 'Cancelled': return 'bg-rose-50 border-rose-200 text-rose-600'
    case 'Expired':   return 'bg-slate-50 border-slate-200 text-slate-500'
    case 'Open':      return 'bg-amber-50 border-amber-200 text-amber-700'
    default:          return 'bg-slate-50 border-slate-200 text-slate-400'
  }
}

// ── Scan banner ───────────────────────────────────────────────────────────────

/**
 * D12 FIX: "Load full history" is now always accessible as a separate action,
 * not hidden behind a completion state. This removes the unreachable-button bug
 * where the button only appeared after the recent scan finished.
 *
 * D15 FIX: uses scanProgress.recentComplete (set by recent-mode scans) for
 * the "Recent history loaded" banner, not scanProgress.isComplete (which is
 * only true for full-mode scans).
 */
function ScanBanner({
  isScanning, scanProgress, scanMode, onRescan, onRescanFull,
}: {
  isScanning: boolean
  scanProgress: { scannedBlock: bigint; headBlock: bigint; isComplete: boolean; recentComplete: boolean; failedRanges: { fromBlock: bigint; toBlock: bigint; error: string }[] }
  scanMode: ScanMode
  onRescan: () => void
  onRescanFull: () => void
}) {
  const [showFullWarning, setShowFullWarning] = useState(false)

  // D15 FIX: derive "coverage complete" from the right flag
  const coverageComplete = scanProgress.isComplete || scanProgress.recentComplete
  const actualBlocks = scanProgress.headBlock - scanProgress.scannedBlock
  const blocksLeft = actualBlocks > 0n ? actualBlocks : 0n

  // "Load full history" action — D12: always available, not hidden behind complete state
  const loadFullHistoryAction = scanMode !== 'full' && (
    showFullWarning ? (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-amber-600">
          Scans from block {ARC_TESTNET_DEPLOYMENT.block.toString()} to head — may take several minutes.
        </span>
        <button onClick={() => { setShowFullWarning(false); onRescanFull() }}
          className="text-rose-600 font-medium hover:underline text-xs">Yes, scan all</button>
        <button onClick={() => setShowFullWarning(false)}
          className="hover:underline text-xs">Cancel</button>
      </div>
    ) : (
      <button onClick={() => setShowFullWarning(true)}
        className="text-slate-400 hover:text-slate-600 underline text-xs shrink-0">
        Load full history
      </button>
    )
  )

  if (!isScanning && coverageComplete && scanProgress.failedRanges.length === 0) {
    return (
      <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={13} className="text-emerald-500" />
          <span>
            {scanProgress.isComplete ? 'Full history loaded' : 'Recent history loaded'}
            {' '}· block {scanProgress.headBlock.toString()}
          </span>
        </div>
        {loadFullHistoryAction}
      </div>
    )
  }

  if (isScanning) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2.5 text-xs text-slate-600">
          <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />
          <span className="flex-1">
            Scanning {scanMode === 'full' ? 'full' : 'recent'} history…{' '}
            <span className="text-slate-400">
              {blocksLeft.toString()} blocks remaining · block {scanProgress.scannedBlock.toString()}
            </span>
          </span>
          <span className="text-amber-500 font-medium text-xs">Totals incomplete</span>
        </div>
        {/* D12: show Load full history even while scanning */}
        <div className="pl-5">{loadFullHistoryAction}</div>
      </div>
    )
  }

  if (scanProgress.failedRanges.length > 0) {
    return (
      <div className="space-y-1.5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-center gap-2.5 text-xs text-amber-700">
          <AlertTriangle size={13} className="text-amber-500 shrink-0" />
          <span className="flex-1">
            {scanProgress.failedRanges.length} range(s) failed — some totals may be missing.
            Failed ranges are not counted as zero.
          </span>
          <button onClick={onRescan}
            className="flex items-center gap-0.5 font-medium hover:underline shrink-0">
            <RefreshCw size={11} /> Retry
          </button>
        </div>
        <div className="pl-1">{loadFullHistoryAction}</div>
      </div>
    )
  }

  // Scanning has not started yet or is in initial load
  return (
    <div className="space-y-1.5">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />
        <span>Loading history — totals incomplete until scan finishes</span>
      </div>
      <div className="pl-1">{loadFullHistoryAction}</div>
    </div>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({
  created, paid, incomplete,
}: {
  created: CreatedEvent[]
  paid: PaymentEvent[]
  incomplete: boolean
}) {
  const collected = sumBigInt(paid.map(e => e.amount))
  const p = incomplete ? '~' : ''
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: 'Collected', value: `${p}${formatUsdc(collected)} USDC`, sub: 'Confirmed payments only' },
        { label: 'Payments',  value: `${p}${paid.length}`,               sub: 'Paid requests in period' },
        { label: 'Created',   value: `${p}${created.length}`,            sub: 'Orders created in period' },
      ].map(({ label, value, sub }) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-xs text-slate-400 font-medium">{label}</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{value}</p>
          <p className="text-xs text-slate-400">{sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Bar chart (SVG, no library) ───────────────────────────────────────────────

function DailyBarChart({
  monthStart, paid, incomplete,
}: {
  monthStart: number
  paid: PaymentEvent[]
  incomplete: boolean
}) {
  const days = useMemo(() => daysInUtcMonth(monthStart), [monthStart])

  const bars = useMemo(() => {
    return days.map(dayStart => {
      const dayPaid = paid.filter(e => e.paidAt >= dayStart && e.paidAt < dayStart + 86400)
      const collected = sumBigInt(dayPaid.map(e => e.amount))
      return { dayStart, collected, count: dayPaid.length }
    })
  }, [days, paid])

  const maxVal = useMemo(
    () => bars.reduce((m, b) => b.collected > m ? b.collected : m, 0n),
    [bars]
  )

  if (bars.every(b => b.collected === 0n)) {
    return (
      <div className="text-xs text-slate-400 text-center py-4">
        {incomplete ? 'No confirmed payments yet — scan still loading.' : 'No payments in this month.'}
      </div>
    )
  }

  const W = 560
  const H = 80
  const barW = Math.max(2, Math.floor(W / bars.length) - 2)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Daily collection bar chart"
        className="block"
        style={{ minWidth: Math.max(bars.length * 10, 200) }}
      >
        {bars.map((bar, i) => {
          const x = i * (W / bars.length)
          const barH = maxVal > 0n
            ? Math.max(2, Math.round(Number((bar.collected * BigInt(H - 8)) / maxVal)))
            : 0
          const y = H - barH
          const isZero = bar.collected === 0n
          return (
            <g key={bar.dayStart}>
              <title>
                {fmtUtcDate(bar.dayStart)}: {formatUsdc(bar.collected)} USDC ({bar.count} payment{bar.count !== 1 ? 's' : ''})
              </title>
              <rect
                x={x + 1} y={y} width={barW} height={barH}
                className={isZero
                  ? (incomplete ? 'fill-amber-100' : 'fill-slate-100')
                  : 'fill-emerald-400'}
                rx={2}
              />
            </g>
          )
        })}
      </svg>
      {/* Accessible table */}
      <details className="mt-2">
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
          Show as table
        </summary>
        <table className="w-full text-xs mt-2 border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-1 pr-3 text-slate-500 font-medium">Date (UTC)</th>
              <th className="text-right py-1 pr-3 text-slate-500 font-medium">Collected</th>
              <th className="text-right py-1 text-slate-500 font-medium">Payments</th>
            </tr>
          </thead>
          <tbody>
            {bars.filter(b => b.count > 0).map(bar => (
              <tr key={bar.dayStart} className="border-b border-slate-100">
                <td className="py-1 pr-3 text-slate-600">{fmtUtcDate(bar.dayStart)}</td>
                <td className="py-1 pr-3 text-right font-semibold text-emerald-700 tabular-nums">
                  {incomplete ? '~' : ''}{formatUsdc(bar.collected)} USDC
                </td>
                <td className="py-1 text-right text-slate-600">{bar.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

// ── Detail records table ──────────────────────────────────────────────────────

interface DetailRow {
  requestId: bigint
  createdAt: number | null   // null = not in scan window
  paidAt: number | null
  amount: bigint
  payer: string
  status: string
  txHash: string | null
}

function DetailTable({
  rows, incomplete,
}: {
  rows: DetailRow[]
  incomplete: boolean
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('payment')
  const [page, setPage] = useState(1)
  const nav = useNavigate()

  // D13 FIX: filter AND sort rows by the chosen date column
  const filtered = useMemo(() => {
    let result = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(r => r.requestId.toString().includes(q))
    }
    if (statusFilter !== 'all') {
      const want = statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)
      result = result.filter(r => r.status === want)
    }
    // Sort by the selected date column (newest first)
    result = [...result].sort((a, b) => {
      const aTs = dateFilter === 'payment'
        ? (a.paidAt ?? a.createdAt ?? 0)
        : (a.createdAt ?? a.paidAt ?? 0)
      const bTs = dateFilter === 'payment'
        ? (b.paidAt ?? b.createdAt ?? 0)
        : (b.createdAt ?? b.paidAt ?? 0)
      return bTs - aTs
    })
    return result
  }, [rows, search, statusFilter, dateFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset to page 1 when filters change
  const handleSearch = useCallback((v: string) => { setSearch(v); setPage(1) }, [])
  const handleStatus = useCallback((v: StatusFilter) => { setStatusFilter(v); setPage(1) }, [])

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-36">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search request ID…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => handleStatus(e.target.value as StatusFilter)}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="open">Open</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>Sort by</span>
          <button
            onClick={() => { setDateFilter(d => d === 'payment' ? 'creation' : 'payment'); setPage(1) }}
            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 font-medium"
            title="Toggle sort between payment date and creation date"
          >
            {dateFilter === 'payment' ? 'Payment date' : 'Creation date'}
          </button>
        </div>
      </div>

      {/* Sort label */}
      <p className="text-xs text-slate-400">
        Sorted by <span className="font-semibold text-slate-600">
          {dateFilter === 'payment' ? 'payment date (paidAt)' : 'creation date (RequestCreated block timestamp)'}
        </span> · {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        {incomplete && <span className="text-amber-500"> · scan incomplete, some records may be missing</span>}
      </p>

      {/* Table */}
      {pageRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
          {filtered.length === 0 ? 'No records match these filters.' : 'No records on this page.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">ID</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Created (UTC)</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Paid (UTC)</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-semibold">Amount</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold hidden sm:table-cell">Payer</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map(row => (
                  <tr key={row.requestId.toString()} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-slate-500">#{row.requestId.toString()}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {row.createdAt
                        ? <><span>{fmtUtcDate(row.createdAt)}</span><br /><span className="text-slate-400">{fmtUtcTime(row.createdAt)}</span></>
                        : <span className="text-slate-300 italic">not in scan</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {row.paidAt
                        ? <><span>{fmtUtcDate(row.paidAt)}</span><br /><span className="text-slate-400">{fmtUtcTime(row.paidAt)}</span></>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                      {formatUsdc(row.amount)} USDC
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400 hidden sm:table-cell">
                      {row.payer && row.payer !== '0x0000000000000000000000000000000000000000'
                        ? <span title={row.payer}>{row.payer.slice(0, 6)}…{row.payer.slice(-4)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-xs font-medium ${statusBadge(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void nav(`/receipt/${row.requestId.toString()}`)}
                          className="text-emerald-600 hover:underline font-medium"
                        >
                          Receipt
                        </button>
                        {row.txHash && (
                          <a
                            href={`${EXPLORER_BASE}/tx/${row.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-slate-600"
                            title="View on explorer"
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={11} /> Prev
          </button>
          <span>Page {safePage} of {totalPages} · {filtered.length} records</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors"
          >
            Next <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Custom range picker ───────────────────────────────────────────────────────

function CustomRangePicker({ onApply }: { onApply: (from: number, to: number) => void }) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState('')
  const [err, setErr]           = useState('')

  const apply = () => {
    setErr('')
    if (!fromDate || !toDate) { setErr('Select both dates.'); return }
    const fp = fromDate.split('-').map(Number)
    const tp = toDate.split('-').map(Number)
    const fSecs = Date.UTC(fp[0], fp[1] - 1, fp[2]) / 1000
    const tSecs = Date.UTC(tp[0], tp[1] - 1, tp[2]) / 1000 + 86400
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

// ── Export / Print ────────────────────────────────────────────────────────────

function buildCsvContent(
  merchant: string,
  periodLabel: string,
  fromSecs: number,
  toSecs: number,
  verifiedThrough: string,
  isComplete: boolean,
  rows: DetailRow[]
): string {
  const lines: string[] = []

  // Header block
  lines.push(csvRow(['ArcReceipt — Payment Report']))
  lines.push(csvRow(['Merchant', merchant]))
  lines.push(csvRow(['Network', 'Arc Testnet (Chain 5042002)']))
  lines.push(csvRow(['Contract', CONTRACT_ADDRESS]))
  lines.push(csvRow(['Period (UTC)', periodLabel]))
  lines.push(csvRow(['From (UTC)', fmtUtcFull(fromSecs)]))
  lines.push(csvRow(['To (UTC)', fmtUtcFull(toSecs - 1)]))
  lines.push(csvRow(['Generated (UTC)', isoUtc()]))
  lines.push(csvRow(['Verified through block', verifiedThrough]))
  lines.push(csvRow(['Completeness', isComplete ? 'Complete — full history scanned' : 'PARTIAL — scan incomplete at export time']))
  if (!isComplete) {
    lines.push(csvRow(['WARNING', 'These totals may be incomplete. Rescan before treating as authoritative.']))
  }
  lines.push('')

  // Summary
  const paidRows = rows.filter(r => r.status === 'Paid')
  const totalCollected = sumBigInt(paidRows.map(r => r.amount))
  lines.push(csvRow(['SUMMARY']))
  lines.push(csvRow(['Confirmed collected (USDC)', formatUsdc(totalCollected)]))
  lines.push(csvRow(['Confirmed payments', paidRows.length.toString()]))
  lines.push(csvRow(['Requests created', rows.length.toString()]))
  lines.push('')

  // Column headers
  lines.push(csvRow([
    'Request ID', 'Created (UTC)', 'Paid (UTC)',
    'Amount (USDC)', 'Payer', 'Status',
    'Receipt URL', 'Explorer (payment TX)',
  ]))

  // Data rows — local item descriptions deliberately excluded (not onchain)
  for (const row of rows) {
    lines.push(csvRow([
      row.requestId.toString(),
      row.createdAt ? fmtUtcFull(row.createdAt) : '',
      row.paidAt    ? fmtUtcFull(row.paidAt)    : '',
      formatUsdc(row.amount),
      row.payer,
      row.status,
      buildReceiptLink(row.requestId),
      row.txHash ? `${EXPLORER_BASE}/tx/${row.txHash}` : '',
    ]))
  }

  return lines.join('\r\n')
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Period row (expandable) ───────────────────────────────────────────────────

function PeriodRow({
  label, from, to, created, paid, incomplete, children,
}: {
  label: string; from: number; to: number
  created: CreatedEvent[]; paid: PaymentEvent[]
  incomplete: boolean; children?: React.ReactNode
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
              {fmtUtcDate(from)} – {fmtUtcDate(to - 1)} UTC
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs text-slate-400">Collected</p>
            <p className="text-sm font-bold text-emerald-700 tabular-nums">{prefix}{formatUsdc(collected)} USDC</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Created</p>
            <p className="text-sm font-semibold text-slate-700">{prefix}{created.length}</p>
          </div>
          {expanded
            ? <ChevronUp size={14} className="text-slate-400" />
            : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantReportsPage() {
  const merchant = MERCHANT_ADDRESS
  const now = nowSecs()

  const {
    createdEvents, paymentEvents, scanProgress, isScanning,
    scanMode, isRecentComplete, rescan, rescanFull,
  } = useEventHistory(merchant)

  const { requestMap } = useMerchantAllRequests(merchant)

  const [activePeriod, setActivePeriod] = useState<PeriodKey>('this-month')
  const [customFrom, setCustomFrom] = useState(0)
  const [customTo, setCustomTo]     = useState(0)
  const [showExportWarning, setShowExportWarning] = useState(false)

  const periods = useMemo(() => buildPeriods(now), [now])

  const activePeriodSpec = useMemo((): PeriodSpec | null => {
    if (activePeriod === 'custom') {
      if (!customFrom || !customTo) return null
      return { key: 'custom', label: 'Custom range', fromSecs: customFrom, toSecs: customTo }
    }
    return periods.find(p => p.key === activePeriod) ?? null
  }, [activePeriod, periods, customFrom, customTo])

  // Filter events by period
  const activeCreated = useMemo(() =>
    activePeriodSpec
      ? createdEvents.filter(e => e.createdAt >= activePeriodSpec.fromSecs && e.createdAt < activePeriodSpec.toSecs)
      : [],
    [createdEvents, activePeriodSpec]
  )
  const activePaid = useMemo(() =>
    activePeriodSpec
      ? paymentEvents.filter(e => e.paidAt >= activePeriodSpec.fromSecs && e.paidAt < activePeriodSpec.toSecs)
      : [],
    [paymentEvents, activePeriodSpec]
  )

  // D15 FIX: recent-mode scans set recentComplete (not isComplete) when done.
  // isComplete is only true for full-mode scans.
  const coverageComplete = scanProgress.isComplete || isRecentComplete
  const isIncomplete = !coverageComplete || scanProgress.failedRanges.length > 0

  // ── Build detail rows ──────────────────────────────────────────────────────
  // Join createdEvents and paymentEvents by requestId for the period.
  // Also include requests from requestMap that appear in the period.

  // Payment TX hashes from events (requestId → txHash)
  const payTxMap = useMemo(() => {
    const map = new Map<string, string>()
    // paymentEvents don't carry txHash in the current schema; we store only key (txHash-logIndex)
    // Extract txHash from the key field (format: "0x...-N")
    for (const ev of paymentEvents) {
      const dashIdx = ev.key.lastIndexOf('-')
      if (dashIdx > 0) {
        const hash = ev.key.slice(0, dashIdx)
        if (hash.startsWith('0x') && hash.length === 66) {
          map.set(ev.requestId.toString(), hash)
        }
      }
    }
    return map
  }, [paymentEvents])

  // createdAt lookup by requestId
  const createdAtLookup = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of createdEvents) map.set(ev.requestId.toString(), ev.createdAt)
    return map
  }, [createdEvents])

  // paidAt lookup by requestId
  const paidAtLookup = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of paymentEvents) map.set(ev.requestId.toString(), ev.paidAt)
    return map
  }, [paymentEvents])

  // Build the full set of requestIds in the selected period
  const periodRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ev of activeCreated) ids.add(ev.requestId.toString())
    for (const ev of activePaid) ids.add(ev.requestId.toString())
    return ids
  }, [activeCreated, activePaid])

  const detailRows = useMemo((): DetailRow[] => {
    const rows: DetailRow[] = []
    for (const idStr of periodRequestIds) {
      const req = requestMap.get(idStr)
      const id = BigInt(idStr)
      const createdAt = createdAtLookup.get(idStr) ?? null
      const paidAt = paidAtLookup.get(idStr) ?? null
      const amount = req?.amount ?? activeCreated.find(e => e.requestId.toString() === idStr)?.amount
        ?? activePaid.find(e => e.requestId.toString() === idStr)?.amount ?? 0n
      const payer = req?.payer ?? activePaid.find(e => e.requestId.toString() === idStr)?.payer ?? ''
      const status = requestStatus(req, now)
      const txHash = payTxMap.get(idStr) ?? null
      rows.push({ requestId: id, createdAt, paidAt, amount, payer: payer, status, txHash })
    }
    return rows.sort((a, b) => {
      // Sort by most-recent activity first
      const aTs = a.paidAt ?? a.createdAt ?? 0
      const bTs = b.paidAt ?? b.createdAt ?? 0
      return bTs - aTs
    })
  }, [periodRequestIds, requestMap, createdAtLookup, paidAtLookup, activePaid, activeCreated, payTxMap, now])

  // ── Export handlers ───────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (isIncomplete && !showExportWarning) {
      setShowExportWarning(true)
      return
    }
    setShowExportWarning(false)
    if (!activePeriodSpec) return
    const csv = buildCsvContent(
      merchant ?? 'unknown',
      activePeriodSpec.label,
      activePeriodSpec.fromSecs,
      activePeriodSpec.toSecs,
      scanProgress.headBlock.toString(),
      coverageComplete,    // D15 FIX: use combined flag
      detailRows,
    )
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(csv, `arcreceipt-${activePeriod}-${date}.csv`)
  }, [isIncomplete, showExportWarning, activePeriodSpec, merchant, scanProgress, coverageComplete, detailRows, activePeriod])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const PERIOD_BUTTONS: { key: PeriodKey; label: string }[] = [
    { key: 'today',      label: 'Today' },
    { key: 'yesterday',  label: 'Yesterday' },
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
    { key: 'custom',     label: 'Custom' },
  ]

  const isMonthView = activePeriod === 'this-month' || activePeriod === 'last-month'

  return (
    <div className="space-y-5">

      {/* Print header (hidden on screen) */}
      <div className="hidden print:block space-y-1 mb-4 border-b pb-4">
        <h1 className="text-xl font-bold">ArcReceipt — Payment Report</h1>
        <p className="text-sm text-slate-600">Merchant: {merchant}</p>
        <p className="text-sm text-slate-600">Network: Arc Testnet (Chain 5042002) · Contract: {CONTRACT_ADDRESS}</p>
        <p className="text-sm text-slate-600">Period: {activePeriodSpec?.label} · Generated: {isoUtc()}</p>
        <p className="text-sm text-slate-600">Verified through block: {scanProgress.headBlock.toString()}</p>
        <p className={`text-sm font-semibold ${isIncomplete ? 'text-amber-600' : 'text-emerald-600'}`}>
          {isIncomplete
            ? 'PARTIAL EXPORT — scan was incomplete at print time'
            : 'Complete — full history scanned'}
        </p>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 print:hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Reports
        </h1>
        <p className="text-sm text-slate-500 mt-0.5 print:hidden">Daily and monthly history · Reporting timezone: UTC</p>
      </div>

      {/* Scan status */}
      <div className="print:hidden">
        <ScanBanner
          isScanning={isScanning} scanProgress={scanProgress}
          scanMode={scanMode} onRescan={rescan} onRescanFull={rescanFull}
        />
      </div>

      {/* Period picker */}
      <div className="flex gap-1.5 flex-wrap print:hidden">
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
        <div className="print:hidden">
          <CustomRangePicker onApply={(f, t) => { setCustomFrom(f); setCustomTo(t) }} />
        </div>
      )}

      {activePeriodSpec ? (
        <>
          {/* Summary cards */}
          <SummaryCards created={activeCreated} paid={activePaid} incomplete={isIncomplete} />

          {/* Chart — only for month views */}
          {isMonthView && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
                Daily collections — {formatUtcMonth(activePeriodSpec.fromSecs)}
              </p>
              <DailyBarChart
                monthStart={activePeriodSpec.fromSecs}
                paid={activePaid}
                incomplete={isIncomplete}
              />
            </div>
          )}

          {/* Export / Print actions */}
          <div className="flex items-center gap-2 flex-wrap print:hidden">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <Download size={13} /> Export CSV
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <Printer size={13} /> Print
            </button>
            {isIncomplete && (
              <span className="text-xs text-amber-600">
                ~ Scan incomplete — totals may be partial
              </span>
            )}
          </div>

          {/* Incomplete export warning */}
          {showExportWarning && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2 print:hidden">
              <p className="text-xs font-semibold text-amber-700">
                Export is incomplete — the scan has not finished.
              </p>
              <p className="text-xs text-amber-600">
                The CSV will be labelled PARTIAL and totals may be lower than actual.
                Rescan first for complete results.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 transition-colors"
                >
                  Export partial anyway
                </button>
                <button
                  onClick={() => setShowExportWarning(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Period summary row (expandable) */}
          <PeriodRow
            label={activePeriod === 'today'
              ? `Today — ${formatUtcDay(activePeriodSpec.fromSecs)}`
              : activePeriod === 'yesterday'
                ? `Yesterday — ${formatUtcDay(activePeriodSpec.fromSecs)}`
                : activePeriod === 'this-month' || activePeriod === 'last-month'
                  ? formatUtcMonth(activePeriodSpec.fromSecs)
                  : `${fmtUtcDate(activePeriodSpec.fromSecs)} – ${fmtUtcDate(activePeriodSpec.toSecs - 1)}`
            }
            from={activePeriodSpec.fromSecs}
            to={activePeriodSpec.toSecs}
            created={activeCreated}
            paid={activePaid}
            incomplete={isIncomplete}
          />

          {/* Detailed records table */}
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-widest uppercase text-slate-400">
              Detailed records
            </p>
            <DetailTable rows={detailRows} incomplete={isIncomplete} />
          </div>
        </>
      ) : activePeriod === 'custom' ? (
        <p className="text-xs text-slate-400 text-center py-4">Select a date range above and click Apply.</p>
      ) : null}

      {/* Incomplete disclaimer */}
      {isIncomplete && (
        <p className="text-xs text-amber-600 text-center print:hidden">
          ~ Amounts marked ~ are based on history scanned so far. Rescan to update.
        </p>
      )}

      {/* Data honesty footer */}
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-400 space-y-1 print:block">
        <p className="font-medium text-slate-500">Data notes</p>
        <p>
          Creation dates: <code className="font-mono bg-white px-1 rounded">RequestCreated</code> block timestamps.{' '}
          Payment dates: <code className="font-mono bg-white px-1 rounded">PaymentRecorded</code> log data.
        </p>
        <p>
          Collected = confirmed USDC from paid requests only. Expired and cancelled requests are not revenue.
          An order created on day D and paid on day D+1 counts in D's Created and D+1's Collected.
        </p>
        <p>
          End-of-day status snapshots are not available — current verified status shown alongside original dates.
          Local item descriptions are merchant notes only, not onchain, and are excluded from exports.
        </p>
        <p>
          Collections are not labelled as profit, tax revenue, or inventory sales.
        </p>
        {!scanProgress.isComplete && (
          <p className="text-amber-500 font-medium">
            Scan not complete — data covers blocks up to {scanProgress.scannedBlock.toString()} of {scanProgress.headBlock.toString()}.
          </p>
        )}
      </div>

    </div>
  )
}
