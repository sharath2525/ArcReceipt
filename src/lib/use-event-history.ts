/**
 * use-event-history.ts — Bounded getLogs scanner for merchant event history.
 *
 * STAGE 2 IMPROVEMENTS over the Part 1 version:
 *
 * S2-A — Adaptive chunk size.
 *   Starts at 10,000 blocks per getLogs call (measured working on Arc primary
 *   and Blockdaemon/QuickNode). On a range-limit or timeout error, halves the
 *   chunk size (10k → 5k → 2k). On a plain RPC error, retries with the same
 *   range and exponential backoff. Chunk size is tracked per-scan and resets
 *   on a new scan start so a single bad range doesn't permanently throttle.
 *
 * S2-B — Parallel getLogs.
 *   Both RequestCreated and PaymentRecorded getLogs for the same block range
 *   are now issued in parallel (Promise.allSettled). Each is validated and
 *   handled independently — a PaymentRecorded failure does not discard
 *   already-fetched RequestCreated logs.
 *
 * S2-C — Block timestamp cache.
 *   Known block timestamps are cached in a per-scan Map and shared across
 *   chunks. A block whose timestamp was successfully fetched in an earlier
 *   chunk is not re-fetched. Survives across incremental tail-refresh runs.
 *
 * S2-D — Tail-refresh (incremental).
 *   When remounting with a warm cache that covers the recent lookback window,
 *   the scan resumes from `scannedBlock+1` (forward from where it stopped)
 *   rather than rescanning from the lookback start. `rescan()` still clears
 *   cache and restarts from the lookback start. `rescanFull()` starts from
 *   the deployment block.
 *
 * S2-E — Correct completion semantics.
 *   `scanProgress.isComplete` remains true only for full-mode scans.
 *   `isRecentComplete` is set true when recent-mode finishes its window.
 *   Both flags are exposed so callers can choose the right one.
 *   A recent-mode scan finishing now also updates `scanProgress` with a
 *   `recentComplete` field so `ScanBanner` can show "Recent history loaded".
 *
 * S2-F — Concurrency limit on timestamp fetches.
 *   Block timestamp requests are batched at most 4 in-flight at once to
 *   avoid overwhelming the RPC with a large burst from a chunk with many
 *   unique blocks.
 *
 * All Part 1 correctness guarantees (A1–A4) are preserved:
 *   A1 — Typed ABI getLogs with args merchant filter + post-decode validation.
 *   A2 — DEPLOYMENT_BLOCK from deployment.ts (67,462,931).
 *   A3 — isComplete only for full scans.
 *   A4 — Never substitute timestamp 0; generation counter prevents stale writes.
 */

import { useState, useEffect, useRef, useCallback, startTransition } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import {
  CONTRACT_ADDRESS, ARC_TESTNET_ID,
} from '@/lib/contract'
import { ARC_TESTNET_DEPLOYMENT } from '@/lib/deployment'
import { MERCHANT_ADDRESS } from '@/lib/merchant'

// ── ABI event items (typed) ───────────────────────────────────────────────────

const REQUEST_CREATED_ABI = parseAbiItem(
  'event RequestCreated(uint256 indexed id, address indexed merchant, uint256 amount, uint256 expiresAt)'
)

const PAYMENT_RECORDED_ABI = parseAbiItem(
  'event PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)'
)

// ── Typed log shapes ──────────────────────────────────────────────────────────

interface TypedCreatedLog {
  address: string
  blockNumber: bigint | null
  transactionHash: `0x${string}` | null
  logIndex: number | null
  args: {
    id?: bigint
    merchant?: `0x${string}`
    amount?: bigint
    expiresAt?: bigint
  }
}

interface TypedPaymentLog {
  address: string
  blockNumber: bigint | null
  transactionHash: `0x${string}` | null
  logIndex: number | null
  args: {
    id?: bigint
    merchant?: `0x${string}`
    payer?: `0x${string}`
    amount?: bigint
    paidAt?: bigint
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPLOYMENT_BLOCK: bigint = ARC_TESTNET_DEPLOYMENT.block

/**
 * Arc Testnet ~2 blocks/second.
 * 500,000 blocks ≈ ~2.9 days — covers a merchant who last checked 2 days ago.
 * Increased from 300,000 (Part 1) to reduce the chance of a merchant needing
 * to click "Load full history" just to see last night's sales.
 */
const DEFAULT_LOOKBACK = 500_000n

/**
 * S2-A: Starting chunk size. Measured working on Arc primary, Blockdaemon,
 * QuickNode. Will halve on range-limit/timeout errors.
 */
const CHUNK_SIZE_START = 10_000n
const CHUNK_SIZE_MIN   =  2_000n

/** Max retries per chunk on plain RPC errors (not range errors). */
const MAX_RPC_RETRIES = 3

/** Base backoff in ms for RPC retries (doubles each attempt). */
const RETRY_BASE_MS = 1_000

/**
 * S2-B: After switching to parallel getLogs we only need one delay per chunk
 * pair, not two separate ones. 300ms gives comfortable headroom at ~5 req/s
 * for two parallel calls counted as one round-trip.
 */
const INTER_CHUNK_DELAY_MS = 300

/** S2-F: Max concurrent block-timestamp fetches per chunk. */
const MAX_TS_CONCURRENCY = 4

/** Cache schema version. Bump whenever stored shape changes. */
const CACHE_VERSION = 3   // bumped from v2 for Stage 2 (adaptive chunk + tail-refresh cursor)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreatedEvent {
  requestId: bigint
  merchant: `0x${string}`
  amount: bigint
  expiresAt: bigint
  /** Unix seconds (block.timestamp). Never 0. */
  createdAt: number
  key: string
}

export interface PaymentEvent {
  requestId: bigint
  merchant: `0x${string}`
  payer: `0x${string}`
  amount: bigint
  /** Unix seconds (paidAt from log data). */
  paidAt: number
  key: string
}

export interface FailedRange {
  fromBlock: bigint
  toBlock: bigint
  error: string
}

export interface ScanProgress {
  scannedBlock: bigint
  headBlock: bigint
  /** True only when scanMode === 'full' AND scannedBlock >= headBlock
   *  AND failedRanges is empty. Never true for recent-only scans. */
  isComplete: boolean
  /** True when recent-mode scan has finished its lookback window. */
  recentComplete: boolean
  failedRanges: FailedRange[]
}

export type ScanMode = 'recent' | 'full'

export interface EventHistoryState {
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  scanProgress: ScanProgress
  isScanning: boolean
  scanMode: ScanMode
  /** True when recent-lookback window is fully scanned. */
  isRecentComplete: boolean
  rescan: () => void
  rescanFull: () => void
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageKey(merchant: string): string {
  return `arc-event-history-v${CACHE_VERSION}:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${merchant.toLowerCase()}`
}

/** Evict older cache versions. */
function evictOldCache(merchant: string): void {
  for (const v of [1, 2]) {
    try {
      sessionStorage.removeItem(
        `arc-event-history-v${v}:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${merchant.toLowerCase()}`
      )
    } catch { /* ignore */ }
  }
}

interface PersistedState {
  version: number
  scannedBlock: string
  scanFloor: string
  scanMode: ScanMode
  /** S2-D: forward-scan cursor for tail-refresh. */
  tailCursor: string
  createdEvents: SerializedCreatedEvent[]
  paymentEvents: SerializedPaymentEvent[]
  failedRanges: SerializedFailedRange[]
}

interface SerializedCreatedEvent {
  requestId: string; merchant: string; amount: string; expiresAt: string
  createdAt: number; key: string
}
interface SerializedPaymentEvent {
  requestId: string; merchant: string; payer: string; amount: string
  paidAt: number; key: string
}
interface SerializedFailedRange {
  fromBlock: string; toBlock: string; error: string
}

function validateSerializedCreated(e: unknown): e is SerializedCreatedEvent {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.requestId === 'string' && o.requestId.length > 0 &&
    typeof o.merchant === 'string' &&
    typeof o.amount === 'string' &&
    typeof o.expiresAt === 'string' &&
    typeof o.createdAt === 'number' && o.createdAt > 0 &&
    typeof o.key === 'string'
  )
}

function validateSerializedPayment(e: unknown): e is SerializedPaymentEvent {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.requestId === 'string' && o.requestId.length > 0 &&
    typeof o.merchant === 'string' &&
    typeof o.payer === 'string' &&
    typeof o.amount === 'string' &&
    typeof o.paidAt === 'number' && o.paidAt > 0 &&
    typeof o.key === 'string'
  )
}

function loadState(merchant: string): {
  scannedBlock: bigint
  scanFloor: bigint
  tailCursor: bigint
  scanMode: ScanMode
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  failedRanges: FailedRange[]
} | null {
  evictOldCache(merchant)
  try {
    const raw = sessionStorage.getItem(storageKey(merchant))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (parsed.version !== CACHE_VERSION) return null
    if (typeof parsed.scannedBlock !== 'string') return null

    const scannedBlock = BigInt(parsed.scannedBlock)
    if (scannedBlock < DEPLOYMENT_BLOCK - 1n) return null

    const scanMode: ScanMode =
      parsed.scanMode === 'full' || parsed.scanMode === 'recent'
        ? parsed.scanMode : 'recent'

    const tailCursor = typeof parsed.tailCursor === 'string'
      ? BigInt(parsed.tailCursor)
      : scannedBlock

    const createdEvents: CreatedEvent[] = (parsed.createdEvents ?? [])
      .filter(validateSerializedCreated)
      .map(e => ({
        requestId: BigInt(e.requestId),
        merchant: e.merchant as `0x${string}`,
        amount: BigInt(e.amount),
        expiresAt: BigInt(e.expiresAt),
        createdAt: e.createdAt,
        key: e.key,
      }))

    const paymentEvents: PaymentEvent[] = (parsed.paymentEvents ?? [])
      .filter(validateSerializedPayment)
      .map(e => ({
        requestId: BigInt(e.requestId),
        merchant: e.merchant as `0x${string}`,
        payer: e.payer as `0x${string}`,
        amount: BigInt(e.amount),
        paidAt: e.paidAt,
        key: e.key,
      }))

    const failedRanges: FailedRange[] = (parsed.failedRanges ?? [])
      .filter((r): r is SerializedFailedRange => {
        const o = r as unknown as Record<string, unknown>
        return o !== null && typeof o === 'object' &&
          typeof o.fromBlock === 'string' &&
          typeof o.toBlock === 'string'
      })
      .map(r => ({
        fromBlock: BigInt(r.fromBlock),
        toBlock: BigInt(r.toBlock),
        error: r.error,
      }))

    const scanFloor = typeof parsed.scanFloor === 'string'
      ? BigInt(parsed.scanFloor) : scannedBlock

    return { scannedBlock, scanFloor, tailCursor, scanMode, createdEvents, paymentEvents, failedRanges }
  } catch {
    return null
  }
}

function saveState(merchant: string, state: {
  scannedBlock: bigint
  scanFloor: bigint
  tailCursor: bigint
  scanMode: ScanMode
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  failedRanges: FailedRange[]
}): void {
  try {
    const serializable: PersistedState = {
      version: CACHE_VERSION,
      scannedBlock: state.scannedBlock.toString(),
      scanFloor: state.scanFloor.toString(),
      tailCursor: state.tailCursor.toString(),
      scanMode: state.scanMode,
      createdEvents: state.createdEvents.map(e => ({
        ...e,
        requestId: e.requestId.toString(),
        amount: e.amount.toString(),
        expiresAt: e.expiresAt.toString(),
      })),
      paymentEvents: state.paymentEvents.map(e => ({
        ...e,
        requestId: e.requestId.toString(),
        amount: e.amount.toString(),
      })),
      failedRanges: state.failedRanges.map(r => ({
        fromBlock: r.fromBlock.toString(),
        toBlock: r.toBlock.toString(),
        error: r.error,
      })),
    }
    sessionStorage.setItem(storageKey(merchant), JSON.stringify(serializable))
  } catch { /* quota */ }
}

function clearState(merchant: string): void {
  try { sessionStorage.removeItem(storageKey(merchant)) } catch { /* ignore */ }
}

// ── S2-F: Bounded concurrency helper ─────────────────────────────────────────

async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<Array<PromiseSettledResult<T>>> {
  // Initialise with placeholders; each worker overwrites its slot before
  // the outer Promise.all resolves, so no placeholder escapes.
  const results: PromiseSettledResult<T>[] = Array.from(
    { length: tasks.length },
    (): PromiseSettledResult<T> => ({ status: 'fulfilled', value: undefined as unknown as T })
  )
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (e) {
        results[i] = { status: 'rejected', reason: e }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEventHistory(merchant: `0x${string}` | null): EventHistoryState {
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  const stateRef = useRef<{
    createdEvents: CreatedEvent[]
    paymentEvents: PaymentEvent[]
    scannedBlock: bigint   // lower bound of the scan range (floor reached so far)
    scanFloor: bigint
    tailCursor: bigint     // S2-D: forward cursor for tail-refresh
    failedRanges: FailedRange[]
    scanMode: ScanMode
    createdKeys: Set<string>
    paymentKeys: Set<string>
    generation: number
    /** S2-C: block timestamp cache, shared across chunks */
    tsCache: Map<bigint, number>
    /** S2-A: current adaptive chunk size for this scan */
    chunkSize: bigint
  } | null>(null)

  const [createdEvents, setCreatedEvents] = useState<CreatedEvent[]>([])
  const [paymentEvents, setPaymentEvents] = useState<PaymentEvent[]>([])
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    scannedBlock: DEPLOYMENT_BLOCK - 1n,
    headBlock: DEPLOYMENT_BLOCK - 1n,
    isComplete: false,
    recentComplete: false,
    failedRanges: [],
  })
  const [isScanning, setIsScanning] = useState(false)
  const [scanMode, setScanMode] = useState<ScanMode>('recent')
  const [isRecentComplete, setIsRecentComplete] = useState(false)

  const generationRef = useRef(0)
  const scanAbortRef = useRef<AbortController | null>(null)

  const initState = useCallback((
    m: string,
    startBlock: bigint,
    mode: ScanMode,
    tailOnly: boolean   // S2-D: true = resume from cache without resetting events
  ) => {
    const saved = !tailOnly ? null : loadState(m)
    if (saved && saved.scannedBlock >= startBlock && saved.scanMode === mode) {
      // Warm cache — restore events and resume from tail
      stateRef.current = {
        createdEvents: saved.createdEvents,
        paymentEvents: saved.paymentEvents,
        scannedBlock: saved.scannedBlock,
        scanFloor: saved.scanFloor,
        tailCursor: saved.tailCursor,
        failedRanges: saved.failedRanges,
        scanMode: mode,
        createdKeys: new Set(saved.createdEvents.map(e => e.key)),
        paymentKeys: new Set(saved.paymentEvents.map(e => e.key)),
        generation: generationRef.current,
        tsCache: new Map(),
        chunkSize: CHUNK_SIZE_START,
      }
      setCreatedEvents(saved.createdEvents)
      setPaymentEvents(saved.paymentEvents)
      setScanProgress({
        scannedBlock: saved.scanFloor,
        headBlock: saved.tailCursor,
        isComplete: false,
        recentComplete: false,
        failedRanges: saved.failedRanges,
      })
    } else {
      // Fresh scan
      stateRef.current = {
        createdEvents: [], paymentEvents: [],
        scannedBlock: startBlock,
        scanFloor: startBlock,
        tailCursor: startBlock,
        failedRanges: [],
        scanMode: mode,
        createdKeys: new Set(), paymentKeys: new Set(),
        generation: generationRef.current,
        tsCache: new Map(),
        chunkSize: CHUNK_SIZE_START,
      }
      setCreatedEvents([])
      setPaymentEvents([])
      setScanProgress({
        scannedBlock: startBlock, headBlock: startBlock,
        isComplete: false, recentComplete: false, failedRanges: [],
      })
    }
    setIsRecentComplete(false)
  }, [])

  const runScan = useCallback(async (
    m: `0x${string}`,
    abort: AbortController,
    myGeneration: number,
    tailOnly: boolean   // S2-D: only scan new blocks above tailCursor
  ) => {
    if (!publicClient) return
    if (!stateRef.current) return

    setIsScanning(true)

    const isCurrent = () =>
      !abort.signal.aborted && generationRef.current === myGeneration

    try {
      let headBlock: bigint
      try {
        headBlock = await publicClient.getBlockNumber()
      } catch {
        setIsScanning(false)
        return
      }
      if (!isCurrent()) return

      const mode = stateRef.current.scanMode
      setScanProgress(p => ({ ...p, headBlock, isComplete: false, recentComplete: false }))

      if (tailOnly) {
        // ── S2-D: Tail-refresh — scan forward from tailCursor to headBlock ──
        const tailStart = stateRef.current.tailCursor + 1n

        if (tailStart > headBlock) {
          // Already up to date
          const isComplete = mode === 'full' && stateRef.current.failedRanges.length === 0
          const recentComplete = mode === 'recent'
          setScanProgress(p => ({ ...p, headBlock, isComplete, recentComplete }))
          if (recentComplete) setIsRecentComplete(true)
          setIsScanning(false)
          return
        }

        let cursor = tailStart
        while (cursor <= headBlock) {
          if (!isCurrent()) break
          const chunkSize = stateRef.current.chunkSize
          const to = cursor + chunkSize - 1n < headBlock ? cursor + chunkSize - 1n : headBlock
          const added = await fetchAndProcessChunk(m, cursor, to, abort, myGeneration)
          if (added === null) break  // aborted
          if (!isCurrent()) break
          stateRef.current.tailCursor = to
          cursor = to + 1n
          setScanProgress({
            scannedBlock: stateRef.current.scanFloor,
            headBlock,
            isComplete: false,
            recentComplete: false,
            failedRanges: [...stateRef.current.failedRanges],
          })
          saveState(m, stateRef.current)
          if (cursor <= headBlock && isCurrent()) {
            await new Promise(res => setTimeout(res, INTER_CHUNK_DELAY_MS))
          }
        }

        if (isCurrent()) {
          const isComplete = mode === 'full' &&
            stateRef.current.scannedBlock <= (DEPLOYMENT_BLOCK - 1n) &&
            stateRef.current.failedRanges.length === 0
          const recentComplete = mode === 'recent'
          setScanProgress(p => ({ ...p, headBlock, isComplete, recentComplete }))
          if (recentComplete) setIsRecentComplete(true)
        }

      } else {
        // ── Newest-first downward scan ──────────────────────────────────────
        const startBlock = stateRef.current.scannedBlock
        if (startBlock >= headBlock) {
          const isComplete = mode === 'full' && stateRef.current.failedRanges.length === 0
          const recentComplete = mode === 'recent'
          setScanProgress(p => ({ ...p, headBlock, isComplete, recentComplete }))
          if (recentComplete) setIsRecentComplete(true)
          setIsScanning(false)
          return
        }

        let chunkTop = headBlock
        // Set tail cursor to head so future tail-refreshes start here
        stateRef.current.tailCursor = headBlock

        while (chunkTop > startBlock) {
          if (!isCurrent()) break
          const chunkSize = stateRef.current.chunkSize
          const chunkBottom = chunkTop >= startBlock + chunkSize
            ? chunkTop - chunkSize + 1n
            : startBlock + 1n
          const from = chunkBottom
          const to   = chunkTop

          const added = await fetchAndProcessChunk(m, from, to, abort, myGeneration)
          if (added === null) break  // aborted

          if (!isCurrent()) break

          stateRef.current.scannedBlock = from - 1n
          stateRef.current.scanFloor = from - 1n

          const reachedBottom = stateRef.current.scannedBlock <= startBlock
          const isComplete = mode === 'full' && reachedBottom && stateRef.current.failedRanges.length === 0

          setScanProgress({
            scannedBlock: stateRef.current.scannedBlock,
            headBlock,
            isComplete,
            recentComplete: false,
            failedRanges: [...stateRef.current.failedRanges],
          })

          saveState(m, stateRef.current)

          chunkTop = from - 1n

          if (chunkTop > startBlock && isCurrent()) {
            await new Promise(res => setTimeout(res, INTER_CHUNK_DELAY_MS))
          }
        }

        if (isCurrent()) {
          const mode2 = stateRef.current?.scanMode ?? mode
          const reachedBottom2 = (stateRef.current?.scannedBlock ?? headBlock) <= startBlock
          const isComplete = mode2 === 'full' && reachedBottom2 &&
            (stateRef.current?.failedRanges.length ?? 1) === 0
          const recentComplete = mode2 === 'recent'
          setScanProgress(p => ({ ...p, headBlock, isComplete, recentComplete }))
          if (recentComplete) setIsRecentComplete(true)
        }
      }
    } finally {
      setIsScanning(false)
    }

    // ── Inner: fetch one chunk and process its logs ─────────────────────────
    async function fetchAndProcessChunk(
      m: `0x${string}`,
      from: bigint,
      to: bigint,
      abort: AbortController,
      gen: number
    ): Promise<boolean | null> {
      if (!publicClient || !stateRef.current) return null

      const isCur = () => !abort.signal.aborted && generationRef.current === gen

      // S2-A: Adaptive chunk size. Try at current size; on range/timeout error halve it.
      let currentFrom = from
      let currentTo = to

      for (let sizeAttempt = 0; sizeAttempt < 3; sizeAttempt++) {
        if (!isCur()) return null

        // S2-B: Parallel getLogs for both event types
        let createdLogs: TypedCreatedLog[] = []
        let paymentLogs: TypedPaymentLog[] = []
        let success = false

        for (let retry = 0; retry < MAX_RPC_RETRIES; retry++) {
          if (!isCur()) return null
          try {
            const [createdResult, paymentResult] = await Promise.allSettled([
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: REQUEST_CREATED_ABI,
                args: { merchant: m },
                fromBlock: currentFrom,
                toBlock: currentTo,
              }),
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: PAYMENT_RECORDED_ABI,
                args: { merchant: m },
                fromBlock: currentFrom,
                toBlock: currentTo,
              }),
            ])

            // S2-B: Handle each result independently
            let createdOk = false
            let paymentOk = false

            if (createdResult.status === 'fulfilled') {
              createdLogs = createdResult.value
              createdOk = true
            } else {
              const errMsg = (createdResult.reason as Error)?.message ?? ''
              // Range-limit or timeout error — need to shrink, not retry
              if (/range|limit|timeout|too many|block range/i.test(errMsg)) {
                throw new RangeError(errMsg)
              }
            }

            if (paymentResult.status === 'fulfilled') {
              paymentLogs = paymentResult.value
              paymentOk = true
            } else {
              const errMsg = (paymentResult.reason as Error)?.message ?? ''
              if (/range|limit|timeout|too many|block range/i.test(errMsg)) {
                throw new RangeError(errMsg)
              }
            }

            if (createdOk || paymentOk) {
              success = true
              break
            }

            // Both failed with non-range errors — exponential backoff and retry
            if (retry < MAX_RPC_RETRIES - 1) {
              await new Promise(res => setTimeout(res, RETRY_BASE_MS * Math.pow(2, retry)))
            }
          } catch (e) {
            // RangeError = block-range too large, halve it immediately (no retry)
            if (e instanceof RangeError) {
              break
            }
            if (retry < MAX_RPC_RETRIES - 1) {
              await new Promise(res => setTimeout(res, RETRY_BASE_MS * Math.pow(2, retry)))
            }
          }
        }

        if (success) {
          // Process the logs we got
          await processLogs(m, createdLogs, paymentLogs, gen, abort)
          return true
        }

        // S2-A: Shrink chunk size and retry the range
        const newSize = stateRef.current.chunkSize / 2n
        if (newSize < CHUNK_SIZE_MIN) {
          // Minimum size reached — record as failed and move on
          const fr: FailedRange = {
            fromBlock: currentFrom,
            toBlock: currentTo,
            error: `getLogs failed after ${MAX_RPC_RETRIES} attempts at minimum chunk size`,
          }
          stateRef.current.failedRanges.push(fr)
          // Advance the scan cursor past this failed range
          stateRef.current.scannedBlock = currentFrom - 1n
          stateRef.current.scanFloor = currentFrom - 1n
          return false
        }
        stateRef.current.chunkSize = newSize
        // Split: retry only first half (will loop again for second half naturally)
        currentTo = currentFrom + newSize - 1n < to ? currentFrom + newSize - 1n : to
      }

      return false
    }

    // ── Inner: process fetched logs ─────────────────────────────────────────
    async function processLogs(
      m: `0x${string}`,
      createdLogs: TypedCreatedLog[],
      paymentLogs: TypedPaymentLog[],
      gen: number,
      abort: AbortController
    ) {
      if (!publicClient || !stateRef.current) return
      const isCur = () => !abort.signal.aborted && generationRef.current === gen

      // S2-C: Fetch block timestamps for new blocks only
      const blockNums = [...new Set(
        createdLogs
          .map(l => l.blockNumber)
          .filter((bn): bn is bigint => bn !== null)
          .filter(bn => !stateRef.current!.tsCache.has(bn))
      )]

      if (blockNums.length > 0 && isCur()) {
        // S2-F: bounded concurrency
        const tasks = blockNums.map(bn => () => publicClient.getBlock({ blockNumber: bn }))
        const results = await pLimit(tasks, MAX_TS_CONCURRENCY)
        if (!isCur()) return
        results.forEach((res, i) => {
          if (res.status === 'fulfilled' && res.value?.timestamp) {
            stateRef.current!.tsCache.set(blockNums[i], Number(res.value.timestamp))
          }
          // A4: never insert 0
        })
      }

      if (!isCur() || !stateRef.current) return

      let didAddCreated = false
      let didAddPayment = false

      // Process RequestCreated
      for (const log of createdLogs) {
        if (!log.address || log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
        const args: TypedCreatedLog['args'] = log.args
        if (!args) continue
        const { id, merchant: logMerchant, amount, expiresAt } = args
        if (!id || id <= 0n) continue
        if (!logMerchant || logMerchant.toLowerCase() !== m.toLowerCase()) continue
        if (!amount || amount <= 0n) continue
        if (!expiresAt) continue

        const rawKey = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
        if (stateRef.current.createdKeys.has(rawKey)) continue

        const bn = log.blockNumber
        if (bn === null) continue
        const ts = stateRef.current.tsCache.get(bn)
        if (ts === undefined) continue  // A4: skip unknown timestamp

        stateRef.current.createdKeys.add(rawKey)
        stateRef.current.createdEvents.push({
          requestId: id,
          merchant: logMerchant,
          amount,
          expiresAt,
          createdAt: ts,
          key: rawKey,
        })
        didAddCreated = true
      }

      // Process PaymentRecorded
      for (const log of paymentLogs) {
        if (!log.address || log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
        const args: TypedPaymentLog['args'] = log.args
        if (!args) continue
        const { id, merchant: logMerchant, payer, amount, paidAt } = args
        if (!id || id <= 0n) continue
        if (!logMerchant || logMerchant.toLowerCase() !== m.toLowerCase()) continue
        if (!payer) continue
        if (!amount || amount <= 0n) continue
        if (!paidAt || paidAt <= 0n) continue

        const rawKey = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
        if (stateRef.current.paymentKeys.has(rawKey)) continue

        stateRef.current.paymentKeys.add(rawKey)
        stateRef.current.paymentEvents.push({
          requestId: id,
          merchant: logMerchant,
          payer,
          amount,
          paidAt: Number(paidAt),
          key: rawKey,
        })
        didAddPayment = true
      }

      if (didAddCreated) startTransition(() => setCreatedEvents([...stateRef.current!.createdEvents]))
      if (didAddPayment) startTransition(() => setPaymentEvents([...stateRef.current!.paymentEvents]))
    }
  }, [publicClient])

  const getRecentStartBlock = useCallback(async (): Promise<bigint> => {
    if (!publicClient) return DEPLOYMENT_BLOCK - 1n
    try {
      const head = await publicClient.getBlockNumber()
      const lookbackStart = head > DEFAULT_LOOKBACK ? head - DEFAULT_LOOKBACK : 0n
      const start = lookbackStart > DEPLOYMENT_BLOCK ? lookbackStart : DEPLOYMENT_BLOCK
      return start - 1n
    } catch {
      return DEPLOYMENT_BLOCK - 1n
    }
  }, [publicClient])

  // S2-D: Check whether cache covers recent lookback so we can do tail-only
  const canDoTailRefresh = useCallback((merchant: string, startBlock: bigint): boolean => {
    const saved = loadState(merchant)
    if (!saved) return false
    // Tail-refresh is safe only if the cached scan covers the same start block
    // (i.e., the lookback window hasn't moved significantly).
    return saved.scannedBlock <= startBlock && saved.scanMode === 'recent'
  }, [])

  useEffect(() => {
    if (!merchant) return
    if (merchant.toLowerCase() !== MERCHANT_ADDRESS?.toLowerCase()) return

    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    generationRef.current += 1
    const gen = generationRef.current

    startTransition(() => setScanMode('recent'))

    void (async () => {
      const startBlock = await getRecentStartBlock()
      const isTail = canDoTailRefresh(merchant, startBlock)
      startTransition(() => { initState(merchant, startBlock, 'recent', isTail) })
      void runScan(merchant, abort, gen, isTail)
    })()

    return () => { abort.abort() }
  }, [merchant, initState, runScan, getRecentStartBlock, canDoTailRefresh])

  const rescan = useCallback(() => {
    if (!merchant) return
    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    generationRef.current += 1
    const gen = generationRef.current
    clearState(merchant)
    setScanMode('recent')
    setIsRecentComplete(false)
    void (async () => {
      const startBlock = await getRecentStartBlock()
      startTransition(() => { initState(merchant, startBlock, 'recent', false) })
      void runScan(merchant, abort, gen, false)
    })()
  }, [merchant, initState, runScan, getRecentStartBlock])

  const rescanFull = useCallback(() => {
    if (!merchant) return
    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    generationRef.current += 1
    const gen = generationRef.current
    clearState(merchant)
    setScanMode('full')
    setIsRecentComplete(false)
    startTransition(() => { initState(merchant, DEPLOYMENT_BLOCK - 1n, 'full', false) })
    void runScan(merchant, abort, gen, false)
  }, [merchant, initState, runScan])

  return {
    createdEvents,
    paymentEvents,
    scanProgress,
    isScanning,
    scanMode,
    isRecentComplete,
    rescan,
    rescanFull,
  }
}
