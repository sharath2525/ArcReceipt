/**
 * MyReceipts — customer payment history (§6 of the implementation spec).
 *
 * STAGE 2 IMPROVEMENTS:
 *
 * D16 FIX — Generation counter (proper abort semantics).
 *   Every new scan start increments a `generation` counter. Each async step
 *   checks its own captured generation before writing state. A wallet switch
 *   that starts generation N+1 will leave generation N's writes as no-ops,
 *   even if several getLogs chunks are still in-flight at that moment.
 *   (The old `abortRef` shared flag had a race: the new scan reset it to
 *   `false` immediately, so the old scan could continue a few more chunks.)
 *
 * D17 FIX — Retry / Update / Rebuild semantics.
 *   Three explicit actions:
 *   - Retry:   resumes from where the scan paused (after a network error).
 *              Keeps cached records and continues from `scannedTo + 1`.
 *   - Update:  rescans only new blocks from the cached cursor to chain head.
 *              Fast path for checking for payments since last full scan.
 *   - Rebuild: clears cache, rescans everything from deployment block.
 *              Shows a confirmation prompt first.
 *
 * D18 FIX — "View receipt" link per row.
 *   Each payment row now shows a /receipt/:id navigation link in addition
 *   to the explorer TX link.
 *
 * Part 1 correctness preserved:
 *   A1 — Typed ABI getLogs + args-based payer filter + post-decode validation.
 *   A2 — DEPLOYMENT_BLOCK from deployment.ts (67,462,931).
 *   Cache version bumped to v3 (D16 adds generation-aware cursor fields).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import {
  ExternalLink, RefreshCw, Loader2, Receipt, AlertCircle,
  RotateCcw, ArrowDownToLine,
} from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, ARC_TESTNET_ID,
} from '@/lib/contract'
import { ARC_TESTNET_DEPLOYMENT } from '@/lib/deployment'
import { formatAddr, formatTs } from '@/lib/ui'

const DEPLOYMENT_BLOCK = ARC_TESTNET_DEPLOYMENT.block
const CHUNK_SIZE_START = 10_000n
const CHUNK_SIZE_MIN   =  2_000n
const CACHE_VERSION = 3   // bumped for D16 (generation-aware cursor)

// A1: Typed ABI event
const PAYMENT_RECORDED_ABI = parseAbiItem(
  'event PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)'
)

interface PaymentRecord {
  id: bigint
  merchant: string
  payer: string
  amount: bigint
  paidAt: bigint
  txHash: string
  blockNumber: bigint
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function storageKey(chainId: number, contract: string, payer: string): string {
  return `arc-receipt:my-receipts-v${CACHE_VERSION}:${chainId}:${contract.toLowerCase()}:${payer.toLowerCase()}`
}

function evictOldCache(chainId: number, contract: string, payer: string): void {
  for (const v of [1, 2]) {
    try {
      sessionStorage.removeItem(`arc-receipt:my-receipts-v${v}:${chainId}:${contract.toLowerCase()}:${payer.toLowerCase()}`)
    } catch { /* ignore */ }
  }
}

function validateRecord(r: unknown): r is {
  id: string; merchant: string; payer: string; amount: string
  paidAt: string; txHash: string; blockNumber: string
} {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.merchant === 'string' &&
    typeof o.payer === 'string' &&
    typeof o.amount === 'string' &&
    typeof o.paidAt === 'string' &&
    typeof o.txHash === 'string' &&
    typeof o.blockNumber === 'string'
  )
}

interface CacheEntry {
  records: PaymentRecord[]
  /** Lowest block scanned (downward scan floor). */
  scannedFrom: bigint
  /** Highest block scanned (forward/tail cursor). */
  scannedTo: bigint
}

function loadCache(chainId: number, contract: string, payer: string): CacheEntry | null {
  evictOldCache(chainId, contract, payer)
  try {
    const raw = sessionStorage.getItem(storageKey(chainId, contract, payer))
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      version?: number
      records: unknown[]
      scannedFrom?: string
      scannedTo: string
    }
    if (parsed.version !== CACHE_VERSION) return null
    const scannedTo = BigInt(parsed.scannedTo)
    const scannedFrom = typeof parsed.scannedFrom === 'string'
      ? BigInt(parsed.scannedFrom) : DEPLOYMENT_BLOCK
    if (scannedTo < DEPLOYMENT_BLOCK - 1n) return null
    const records: PaymentRecord[] = (parsed.records ?? [])
      .filter(validateRecord)
      .map(r => ({
        id: BigInt(r.id),
        merchant: r.merchant,
        payer: r.payer,
        amount: BigInt(r.amount),
        paidAt: BigInt(r.paidAt),
        txHash: r.txHash,
        blockNumber: BigInt(r.blockNumber),
      }))
    return { records, scannedFrom, scannedTo }
  } catch { return null }
}

function saveCache(
  chainId: number, contract: string, payer: string,
  records: PaymentRecord[], scannedFrom: bigint, scannedTo: bigint
): void {
  try {
    sessionStorage.setItem(storageKey(chainId, contract, payer), JSON.stringify({
      version: CACHE_VERSION,
      scannedFrom: scannedFrom.toString(),
      scannedTo: scannedTo.toString(),
      records: records.map(r => ({
        id: r.id.toString(), merchant: r.merchant, payer: r.payer,
        amount: r.amount.toString(), paidAt: r.paidAt.toString(),
        txHash: r.txHash, blockNumber: r.blockNumber.toString(),
      })),
    }))
  } catch { /* storage full */ }
}

function dedup(records: PaymentRecord[]): PaymentRecord[] {
  return records
    .filter((r, i, arr) => arr.findIndex(x => x.txHash === r.txHash && x.id === r.id) === i)
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
}

// ── Scan modes ────────────────────────────────────────────────────────────────

type ScanPhase = 'idle' | 'scanning' | 'paused' | 'complete' | 'error'

// ── Main component ────────────────────────────────────────────────────────────

export function MyReceipts() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })
  const navigate = useNavigate()

  const [records, setRecords]         = useState<PaymentRecord[]>([])
  const [_scannedFrom, setScannedFrom] = useState<bigint>(DEPLOYMENT_BLOCK)
  const [scannedTo, setScannedTo]     = useState<bigint | null>(null)
  const [chainHead, setChainHead]     = useState<bigint | null>(null)
  const [phase, setPhase]             = useState<ScanPhase>('idle')
  const [error, setError]             = useState<string | null>(null)
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false)

  // D16: generation counter — each new scan start gets a unique number
  const genRef = useRef(0)
  // Mutable scan state shared between chunks
  const scanStateRef = useRef<{
    records: PaymentRecord[]
    scannedFrom: bigint
    scannedTo: bigint
    chunkSize: bigint
  } | null>(null)

  // ── Core scan function ─────────────────────────────────────────────────────

  const doScan = useCallback(async (
    payer: `0x${string}`,
    fromBlock: bigint,
    /** toBlock = undefined means scan downward to fromBlock from head */
    toBlock: bigint | undefined,
    /** seed records from cache */
    seedRecords: PaymentRecord[],
    seedScannedFrom: bigint,
    seedScannedTo: bigint,
    myGen: number
  ) => {
    if (!publicClient) return

    const isCur = () => genRef.current === myGen

    scanStateRef.current = {
      records: seedRecords,
      scannedFrom: seedScannedFrom,
      scannedTo: seedScannedTo,
      chunkSize: CHUNK_SIZE_START,
    }
    setPhase('scanning')
    setError(null)

    try {
      let head: bigint
      try {
        head = await publicClient.getBlockNumber()
      } catch {
        if (isCur()) { setPhase('error'); setError('Failed to fetch chain head') }
        return
      }
      if (!isCur()) return
      setChainHead(head)

      const scanTo = toBlock !== undefined ? toBlock : head
      let cursor = fromBlock

      while (cursor <= scanTo) {
        if (!isCur()) return

        const { chunkSize } = scanStateRef.current
        let chunkTo = cursor + chunkSize - 1n < scanTo ? cursor + chunkSize - 1n : scanTo
        let success = false

        // S2-A style: adaptive retry — try current range, then half
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          if (!isCur()) return
          const from = cursor
          const to = attempt === 0 ? chunkTo : (cursor + scanStateRef.current.chunkSize / 2n - 1n < scanTo ? cursor + scanStateRef.current.chunkSize / 2n - 1n : scanTo)

          try {
            const logs = await publicClient.getLogs({
              address: CONTRACT_ADDRESS as `0x${string}`,
              event: PAYMENT_RECORDED_ABI,
              args: { payer },
              fromBlock: from,
              toBlock: to,
            })

            if (!isCur()) return

            const newRecs: PaymentRecord[] = []
            for (const log of logs) {
              if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
              const a = log.args
              if (!a) continue
              const { id, merchant, payer: logPayer, amount, paidAt } = a as {
                id: bigint; merchant: `0x${string}`; payer: `0x${string}`
                amount: bigint; paidAt: bigint
              }
              if (!id || id <= 0n) continue
              if (!logPayer || logPayer.toLowerCase() !== payer.toLowerCase()) continue
              if (!merchant) continue
              if (!amount || amount <= 0n) continue
              if (!paidAt || paidAt <= 0n) continue
              newRecs.push({
                id, merchant: merchant.toLowerCase(),
                payer: logPayer.toLowerCase(), amount, paidAt,
                txHash: log.transactionHash ?? '',
                blockNumber: log.blockNumber ?? 0n,
              })
            }

            scanStateRef.current.records = dedup([...scanStateRef.current.records, ...newRecs])
            // Update forward cursor
            if (to > scanStateRef.current.scannedTo) scanStateRef.current.scannedTo = to
            if (from < scanStateRef.current.scannedFrom) scanStateRef.current.scannedFrom = from
            chunkTo = to
            success = true
          } catch (e) {
            const msg = (e as Error)?.message ?? ''
            const isRangeErr = /range|limit|timeout|too many|block range/i.test(msg)
            if (isRangeErr && scanStateRef.current.chunkSize > CHUNK_SIZE_MIN) {
              scanStateRef.current.chunkSize = scanStateRef.current.chunkSize / 2n
            }
            if (attempt === 2 || !isRangeErr) {
              // Non-recoverable for this chunk — pause
              if (isCur()) {
                saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer,
                  scanStateRef.current.records,
                  scanStateRef.current.scannedFrom,
                  scanStateRef.current.scannedTo)
                setRecords(dedup([...scanStateRef.current.records]))
                setScannedFrom(scanStateRef.current.scannedFrom)
                setScannedTo(scanStateRef.current.scannedTo)
                setError('Network error — scan paused. Use Retry to continue.')
                setPhase('paused')
              }
              return
            }
          }
        }

        if (!success) {
          // Couldn't recover — break out
          break
        }

        if (isCur()) {
          setRecords(dedup([...scanStateRef.current.records]))
          setScannedTo(scanStateRef.current.scannedTo)
          setScannedFrom(scanStateRef.current.scannedFrom)
        }

        saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer,
          scanStateRef.current.records,
          scanStateRef.current.scannedFrom,
          scanStateRef.current.scannedTo)

        cursor = chunkTo + 1n
      }

      if (isCur()) {
        setRecords(dedup([...scanStateRef.current.records]))
        setScannedTo(scanStateRef.current.scannedTo)
        setScannedFrom(scanStateRef.current.scannedFrom)
        setChainHead(head)
        setPhase('complete')
      }
    } catch (e) {
      if (isCur()) {
        setError(e instanceof Error ? e.message.slice(0, 120) : 'Scan failed')
        setPhase('error')
      }
    }
  }, [publicClient])

  // ── Wallet change effect ───────────────────────────────────────────────────

  useEffect(() => {
    // D16: increment generation — any in-flight scan with old gen becomes a no-op
    genRef.current += 1
    const myGen = genRef.current

    setShowRebuildConfirm(false)

    if (!address || chainId !== ARC_TESTNET_ID) {
      setRecords([])
      setScannedTo(null)
      setScannedFrom(DEPLOYMENT_BLOCK)
      setChainHead(null)
      setPhase('idle')
      setError(null)
      return
    }

    // Load cache and start tail scan from the cached head
    const cached = loadCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, address)
    if (cached && cached.records.length > 0) {
      // Show cached records immediately
      setRecords(cached.records)
      setScannedFrom(cached.scannedFrom)
      setScannedTo(cached.scannedTo)
      setPhase('scanning')
      setError(null)
      // D17: Update from the cached head (tail-only scan from scannedTo+1 to head)
      void doScan(
        address, cached.scannedTo + 1n, undefined,
        cached.records, cached.scannedFrom, cached.scannedTo,
        myGen
      )
    } else {
      // No cache — fresh scan from deployment block
      setRecords([])
      setScannedFrom(DEPLOYMENT_BLOCK)
      setScannedTo(null)
      setChainHead(null)
      setPhase('scanning')
      setError(null)
      void doScan(
        address, DEPLOYMENT_BLOCK, undefined,
        [], DEPLOYMENT_BLOCK, DEPLOYMENT_BLOCK - 1n,
        myGen
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId])

  // ── D17: Action handlers ──────────────────────────────────────────────────

  /** Retry: resume from where scan paused (keeps cache, advances from scannedTo+1). */
  const handleRetry = useCallback(() => {
    if (!address || phase === 'scanning') return
    genRef.current += 1
    const myGen = genRef.current
    const cached = loadCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, address)
    setError(null)
    if (cached) {
      setPhase('scanning')
      void doScan(
        address, cached.scannedTo + 1n, undefined,
        cached.records, cached.scannedFrom, cached.scannedTo,
        myGen
      )
    } else {
      setPhase('scanning')
      void doScan(
        address, DEPLOYMENT_BLOCK, undefined,
        [], DEPLOYMENT_BLOCK, DEPLOYMENT_BLOCK - 1n,
        myGen
      )
    }
  }, [address, phase, doScan])

  /** Update: scan from cached head to chain head (new payments only). Fast. */
  const handleUpdate = useCallback(() => {
    if (!address || phase === 'scanning') return
    genRef.current += 1
    const myGen = genRef.current
    const cached = loadCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, address)
    const fromBlock = cached ? cached.scannedTo + 1n : DEPLOYMENT_BLOCK
    const seedRec = cached?.records ?? []
    const seedFrom = cached?.scannedFrom ?? DEPLOYMENT_BLOCK
    const seedTo = cached?.scannedTo ?? DEPLOYMENT_BLOCK - 1n
    setError(null)
    setPhase('scanning')
    void doScan(address, fromBlock, undefined, seedRec, seedFrom, seedTo, myGen)
  }, [address, phase, doScan])

  /** Rebuild: clear cache, rescan from deployment block. Shows confirmation. */
  const handleRebuild = useCallback(() => {
    if (!address || phase === 'scanning') return
    try { sessionStorage.removeItem(storageKey(ARC_TESTNET_ID, CONTRACT_ADDRESS, address)) } catch { /* ignore */ }
    genRef.current += 1
    const myGen = genRef.current
    setRecords([])
    setScannedFrom(DEPLOYMENT_BLOCK)
    setScannedTo(null)
    setChainHead(null)
    setError(null)
    setShowRebuildConfirm(false)
    setPhase('scanning')
    void doScan(
      address, DEPLOYMENT_BLOCK, undefined,
      [], DEPLOYMENT_BLOCK, DEPLOYMENT_BLOCK - 1n,
      myGen
    )
  }, [address, phase, doScan])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-2">
        <Receipt size={24} className="mx-auto text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">Connect your wallet</p>
        <p className="text-xs text-slate-400">
          My Receipts shows payments made by your connected wallet.
        </p>
      </div>
    )
  }

  if (chainId !== ARC_TESTNET_ID) {
    return (
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-center text-sm text-amber-700">
        Switch to Arc Testnet (5042002) to view your receipts.
      </div>
    )
  }

  const isScanning = phase === 'scanning'
  const isComplete = phase === 'complete'
  const isPaused   = phase === 'paused'

  const progress = chainHead !== null && scannedTo !== null
    ? `Block ${scannedTo.toString()} / ${chainHead.toString()}`
    : null

  const remaining = chainHead !== null && scannedTo !== null
    ? chainHead - scannedTo : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Payments made by</p>
          <p className="text-xs font-mono text-slate-500">{formatAddr(address)}</p>
        </div>
        {/* D17: Update button — fast tail scan */}
        <button
          onClick={handleUpdate}
          disabled={isScanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs font-medium text-slate-700 transition-colors"
        >
          <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
          {isScanning ? 'Scanning…' : 'Update'}
        </button>
      </div>

      {/* Scan progress */}
      {(isScanning || (!isComplete && scannedTo !== null)) && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className={isScanning ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
            <span className="font-medium">
              {isComplete
                ? 'Scan complete'
                : isScanning
                ? 'Scanning for payments…'
                : isPaused
                ? 'Scan paused — use Retry to continue'
                : 'Partial scan'}
            </span>
          </div>
          {progress && (
            <p>{progress}
              {remaining !== null && remaining > 0n && ` (${remaining.toString()} blocks remaining)`}
            </p>
          )}
          <p className="text-slate-400">
            Starting from deployment block {DEPLOYMENT_BLOCK.toString()}.
            {!isComplete && ' History may be incomplete until scan finishes.'}
          </p>
        </div>
      )}

      {/* Error state with per-error actions */}
      {error && (
        <div className={`rounded-xl border p-3 space-y-2 ${
          records.length === 0
            ? 'bg-rose-50 border-rose-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start gap-2">
            <AlertCircle size={13} className={`shrink-0 mt-0.5 ${records.length === 0 ? 'text-rose-500' : 'text-amber-500'}`} />
            <div>
              <p className={`text-xs font-medium ${records.length === 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                {records.length === 0 ? 'Unable to load payment history' : 'Scan paused — partial results shown'}
              </p>
              <p className={`text-xs mt-0.5 ${records.length === 0 ? 'text-rose-600' : 'text-amber-600'}`}>{error}</p>
            </div>
          </div>
          {/* D17: Retry = resume from pause cursor; Update = tail only; Rebuild = full */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleRetry}
              disabled={isScanning}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-xs font-medium text-slate-700 transition-colors"
            >
              <RotateCcw size={11} className={isScanning ? 'animate-spin' : ''} />
              Retry
            </button>
            <button
              onClick={handleUpdate}
              disabled={isScanning}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-xs font-medium text-slate-700 transition-colors"
            >
              <ArrowDownToLine size={11} /> Update
            </button>
            {!showRebuildConfirm ? (
              <button
                onClick={() => setShowRebuildConfirm(true)}
                disabled={isScanning}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-xs font-medium text-slate-500 transition-colors"
              >
                <RefreshCw size={11} /> Rebuild
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-600">Clear cache and rescan all?</span>
                <button onClick={handleRebuild} disabled={isScanning}
                  className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-50">
                  Yes
                </button>
                <button onClick={() => setShowRebuildConfirm(false)}
                  className="text-xs text-slate-500 hover:underline">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rebuild confirmation (non-error path) */}
      {!error && !isScanning && isComplete && (
        <div className="text-xs text-slate-400 flex items-center justify-between gap-2">
          <p>History belongs to this wallet. Switching wallets changes the displayed history.</p>
          {!showRebuildConfirm ? (
            <button
              onClick={() => setShowRebuildConfirm(true)}
              className="shrink-0 inline-flex items-center gap-1 text-slate-400 hover:text-slate-600 hover:underline"
            >
              <RefreshCw size={11} /> Rebuild
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-amber-600">Clear cache and rescan all?</span>
              <button onClick={handleRebuild} className="text-xs font-semibold text-rose-600 hover:underline">Yes</button>
              <button onClick={() => setShowRebuildConfirm(false)} className="text-xs text-slate-500 hover:underline">Cancel</button>
            </div>
          )}
        </div>
      )}

      {!error && (
        <p className="text-xs text-slate-400">
          History belongs to this wallet. Switching wallets changes the displayed history.
          Shared receipt links always work without a wallet.
        </p>
      )}

      {records.length === 0 && !isScanning && !error ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-1">
          <p className="text-sm font-semibold text-slate-600">
            {isComplete ? 'No payments found' : 'No payments found yet'}
          </p>
          <p className="text-xs text-slate-400">
            {isComplete
              ? 'This wallet has not paid any requests through ArcReceipt.'
              : 'Scan in progress — results will appear as blocks are scanned.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((rec) => (
            <PaymentRecordRow
              key={rec.txHash || rec.id.toString()}
              rec={rec}
              onViewReceipt={(id) => void navigate(`/receipt/${id.toString()}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function PaymentRecordRow({
  rec,
  onViewReceipt,
}: {
  rec: PaymentRecord
  onViewReceipt: (id: bigint) => void
}) {
  const explorerUrl = buildTxExplorerUrl(ARC_TESTNET_ID, rec.txHash)

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">#{rec.id.toString()}</span>
            <span className="text-sm font-semibold text-slate-800">
              {formatUsdc(rec.amount)}{' '}
              <span className="text-xs font-normal text-slate-400">USDC</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Merchant: <span className="font-mono">{formatAddr(rec.merchant)}</span>
          </p>
          {rec.paidAt > 0n && (
            <p className="text-xs text-slate-400">{formatTs(rec.paidAt)}</p>
          )}
        </div>
        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border font-medium text-emerald-700 bg-emerald-50 border-emerald-200">
          Paid
        </span>
      </div>
      {/* D18: receipt link + explorer link */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onViewReceipt(rec.id)}
          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium"
        >
          <Receipt size={11} /> View receipt
        </button>
        {rec.txHash && (
          <a
            href={explorerUrl}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:underline"
          >
            <ExternalLink size={11} /> Explorer
          </a>
        )}
      </div>
    </div>
  )
}
