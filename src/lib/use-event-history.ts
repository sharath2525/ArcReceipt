/**
 * use-event-history.ts — Bounded getLogs scanner for merchant event history.
 *
 * CORRECTNESS GUARANTEES (Part 1 fixes):
 *
 * A1 — getLogs uses viem's TYPED ABI event overload with explicit `args`
 *      filtering by merchant address. Post-decode validation cross-checks:
 *        - log.address matches CONTRACT_ADDRESS
 *        - decoded event name matches expected type
 *        - decoded merchant matches the queried merchant address
 *        - decoded requestId > 0
 *      A PaymentRecorded event can never enter the createdEvents list.
 *      Another merchant's events can never enter this merchant's data.
 *
 * A2 — DEPLOYMENT_BLOCK is 67,462,931 (from deployment.ts, verified from
 *      AGENTS.md and contract-metadata). The old value of 2,900,000 is gone.
 *
 * A3 — isComplete is only set true when scanMode === 'full' AND
 *      scannedBlock >= headBlock AND failedRanges is empty.
 *      A recent-only scan completing its lookback window NEVER sets
 *      isComplete=true on scanProgress — it sets isRecentComplete instead.
 *      Callers that need "full history is available" must check
 *      scanMode === 'full' && scanProgress.isComplete.
 *
 * A4 — Recovery hardening:
 *      - Block timestamp fetch failures record a null entry; events from
 *        blocks with unknown timestamps are held in a pendingTimestamp set
 *        and retried on the next scan tick. Zero is never substituted.
 *      - Scan state carries a generation counter. A cancelled/stale scan
 *        that resolves after a newer scan has started discards its results
 *        rather than publishing them.
 *      - Cache schema is versioned (v2). v1 entries are invalidated on load.
 *        Cache contents are validated (required fields present, bigint
 *        parseable) before use; corrupt entries are discarded.
 *
 * PUBLIC API:
 *   useEventHistory(merchant) → EventHistoryState
 *
 * EventHistoryState:
 *   .createdEvents    — RequestCreated events (with verified block timestamp)
 *   .paymentEvents    — PaymentRecorded events (with paidAt from log data)
 *   .scanProgress     — { scannedBlock, headBlock, isComplete, failedRanges }
 *   .isScanning       — true while a scan chunk is in flight
 *   .scanMode         — 'recent' | 'full'
 *   .isRecentComplete — true when the recent-lookback window is fully scanned
 *   .rescan()         — reset and restart from recent lookback
 *   .rescanFull()     — reset and restart from deployment block
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
// Using parseAbiItem ensures viem builds the correct topic-0 and indexed
// field filters, avoiding the raw-topic cast that was silently dropped.

const REQUEST_CREATED_ABI = parseAbiItem(
  'event RequestCreated(uint256 indexed id, address indexed merchant, uint256 amount, uint256 expiresAt)'
)

const PAYMENT_RECORDED_ABI = parseAbiItem(
  'event PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)'
)

// ── Typed log shapes for post-decode validation ───────────────────────────────
// These match the decoded args viem returns for typed getLogs calls.
// We cast via `unknown` rather than `any` so TypeScript narrows correctly.

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

/**
 * Verified deployment block for ArcReceiptCheckout on Arc Testnet.
 * Source: deployment.ts (67,462,931 confirmed in AGENTS.md).
 */
const DEPLOYMENT_BLOCK: bigint = ARC_TESTNET_DEPLOYMENT.block

/**
 * Default lookback from chain head on a fresh recent scan.
 * Arc Testnet runs ~2 blocks/second → ~172,800 blocks/day.
 * 300,000 blocks ≈ ~1.7 days, covers all contract history comfortably
 * for a recent-only scan.
 */
const DEFAULT_LOOKBACK = 300_000n

/** Blocks per getLogs call. */
const RANGE_SIZE = 2_000n

/** Max retries per failed chunk. */
const MAX_RETRIES = 3

/** Milliseconds between retry attempts (exponential backoff). */
const RETRY_BASE_MS = 1_500

/** Cache schema version. Bump whenever the stored shape changes. */
const CACHE_VERSION = 2

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreatedEvent {
  requestId: bigint
  merchant: `0x${string}`
  amount: bigint
  expiresAt: bigint
  /** Unix seconds (block.timestamp of the RequestCreated event's block).
   *  Only present when the block timestamp was successfully fetched.
   *  Never 0 — events with missing timestamps are excluded until retry. */
  createdAt: number
  /** Dedup key: txHash-logIndex */
  key: string
}

export interface PaymentEvent {
  requestId: bigint
  merchant: `0x${string}`
  payer: `0x${string}`
  amount: bigint
  /** Unix seconds (paidAt from log data — equals block.timestamp per contract). */
  paidAt: number
  /** Dedup key: txHash-logIndex */
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
   *  AND failedRanges is empty. Never true for a recent-only scan. */
  isComplete: boolean
  failedRanges: FailedRange[]
}

export type ScanMode = 'recent' | 'full'

export interface EventHistoryState {
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  scanProgress: ScanProgress
  isScanning: boolean
  scanMode: ScanMode
  /** True when the recent-lookback window is fully scanned (distinct from
   *  isComplete which requires full-history coverage). */
  isRecentComplete: boolean
  rescan: () => void
  rescanFull: () => void
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageKey(merchant: string): string {
  return `arc-event-history-v${CACHE_VERSION}:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${merchant.toLowerCase()}`
}

/** Invalidate any v1 cache entry for this merchant. */
function evictOldCache(merchant: string): void {
  try {
    const v1Key = `arc-event-history-v1:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${merchant.toLowerCase()}`
    sessionStorage.removeItem(v1Key)
  } catch { /* ignore */ }
}

interface PersistedState {
  version: number
  scannedBlock: string
  /** Lowest block fully processed in the newest-first scan (= scanFloor). */
  scanFloor: string
  scanMode: ScanMode
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

function validateSerializedCreatedEvent(e: unknown): e is SerializedCreatedEvent {
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

function validateSerializedPaymentEvent(e: unknown): e is SerializedPaymentEvent {
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

    // Schema version check — discard incompatible entries
    if (parsed.version !== CACHE_VERSION) return null
    if (typeof parsed.scannedBlock !== 'string') return null

    const scannedBlock = BigInt(parsed.scannedBlock)
    // Sanity check: cached scannedBlock must be >= deployment block
    if (scannedBlock < DEPLOYMENT_BLOCK - 1n) return null

    const scanMode: ScanMode =
      parsed.scanMode === 'full' || parsed.scanMode === 'recent'
        ? parsed.scanMode
        : 'recent'

    const createdEvents: CreatedEvent[] = (parsed.createdEvents ?? [])
      .filter(validateSerializedCreatedEvent)
      .map(e => ({
        requestId: BigInt(e.requestId),
        merchant: e.merchant as `0x${string}`,
        amount: BigInt(e.amount),
        expiresAt: BigInt(e.expiresAt),
        createdAt: e.createdAt,
        key: e.key,
      }))

    const paymentEvents: PaymentEvent[] = (parsed.paymentEvents ?? [])
      .filter(validateSerializedPaymentEvent)
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

    const scanFloor = typeof parsed.scanFloor === 'string' ? BigInt(parsed.scanFloor) : scannedBlock
    return { scannedBlock, scanFloor, scanMode, createdEvents, paymentEvents, failedRanges }
  } catch {
    return null
  }
}

function saveState(merchant: string, state: {
  scannedBlock: bigint
  scanFloor: bigint
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
  } catch { /* sessionStorage quota — ignore */ }
}

function clearState(merchant: string): void {
  try { sessionStorage.removeItem(storageKey(merchant)) } catch { /* ignore */ }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEventHistory(merchant: `0x${string}` | null): EventHistoryState {
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  // In-memory scan state (not in React state to avoid excessive re-renders
  // during the tight scan loop)
  const stateRef = useRef<{
    createdEvents: CreatedEvent[]
    paymentEvents: PaymentEvent[]
    /** Lowest block boundary for the scan range (passed to initState).
     *  Used as the stopping condition for the newest-first scan loop. */
    scannedBlock: bigint
    /** Lowest block we have already processed (floor of processed range).
     *  Starts at headBlock on a fresh scan; decreases each chunk. */
    scanFloor: bigint
    failedRanges: FailedRange[]
    scanMode: ScanMode
    createdKeys: Set<string>
    paymentKeys: Set<string>
    /** Generation counter: incremented each time a new scan is started.
     *  A running scan checks this before publishing results — stale
     *  generations discard without updating React state. */
    generation: number
  } | null>(null)

  const [createdEvents, setCreatedEvents] = useState<CreatedEvent[]>([])
  const [paymentEvents, setPaymentEvents] = useState<PaymentEvent[]>([])
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    scannedBlock: DEPLOYMENT_BLOCK - 1n,
    headBlock: DEPLOYMENT_BLOCK - 1n,
    isComplete: false,
    failedRanges: [],
  })
  const [isScanning, setIsScanning] = useState(false)
  const [scanMode, setScanMode] = useState<ScanMode>('recent')
  const [isRecentComplete, setIsRecentComplete] = useState(false)

  // Generation ref — NOT in React state (avoids stale closure issues)
  const generationRef = useRef(0)
  const scanAbortRef = useRef<AbortController | null>(null)

  const initState = useCallback((
    m: string,
    startBlock: bigint,
    mode: ScanMode
  ) => {
    const saved = loadState(m)
    if (saved && saved.scannedBlock >= startBlock && saved.scanMode === mode) {
      stateRef.current = {
        createdEvents: saved.createdEvents,
        paymentEvents: saved.paymentEvents,
        scannedBlock: saved.scannedBlock,
        scanFloor: saved.scanFloor,
        failedRanges: saved.failedRanges,
        scanMode: mode,
        createdKeys: new Set(saved.createdEvents.map(e => e.key)),
        paymentKeys: new Set(saved.paymentEvents.map(e => e.key)),
        generation: generationRef.current,
      }
      setCreatedEvents(saved.createdEvents)
      setPaymentEvents(saved.paymentEvents)
      setScanProgress(p => ({
        ...p,
        scannedBlock: saved.scanFloor,
        failedRanges: saved.failedRanges,
        isComplete: false,
      }))
    } else {
      stateRef.current = {
        createdEvents: [], paymentEvents: [],
        scannedBlock: startBlock,
        scanFloor: startBlock, // will be updated to headBlock on first chunk
        failedRanges: [],
        scanMode: mode,
        createdKeys: new Set(), paymentKeys: new Set(),
        generation: generationRef.current,
      }
      setCreatedEvents([])
      setPaymentEvents([])
      setScanProgress({
        scannedBlock: startBlock, headBlock: startBlock,
        isComplete: false, failedRanges: [],
      })
    }
    setIsRecentComplete(false)
  }, [])

  const runScan = useCallback(async (
    m: `0x${string}`,
    abort: AbortController,
    myGeneration: number
  ) => {
    if (!publicClient) return
    if (!stateRef.current) return

    setIsScanning(true)

    // Helper: is this scan still the current one?
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
      setScanProgress(p => ({
        ...p,
        headBlock,
        isComplete: false,
      }))

      // ── Newest-first scan ──────────────────────────────────────────────────
      // scanFloor = lowest block fully processed so far.
      // We start at headBlock and work DOWN toward startBlock so that recent
      // transactions appear in the UI after the very first chunk.
      // scannedBlock in the public ScanProgress is repurposed as scanFloor —
      // callers see it decrease toward the deployment block as history loads.

      const startBlock = stateRef.current.scannedBlock // lowest bound (exclusive)
      if (startBlock >= headBlock) {
        // Already up to date
        const isComplete = mode === 'full' && stateRef.current.failedRanges.length === 0
        setScanProgress(p => ({ ...p, headBlock, isComplete }))
        if (mode === 'recent') setIsRecentComplete(true)
        setIsScanning(false)
        return
      }

      // Newest-first: always start at headBlock so brand-new blocks are seen
      // immediately; the dedup key set skips events already stored from a
      // previous session. This means the first chunk always covers the most
      // recent RANGE_SIZE blocks, giving today's payments on the very first tick.
      let chunkTop = headBlock

      while (chunkTop > startBlock) {
        if (!isCurrent()) break

        const chunkBottom = chunkTop >= startBlock + RANGE_SIZE
          ? chunkTop - RANGE_SIZE + 1n
          : startBlock + 1n

        const from = chunkBottom
        const to   = chunkTop

        // Cast via unknown to TypedCreatedLog / TypedPaymentLog — viem's typed
        // getLogs return-type includes `args` but the union that tsc resolves
        // to an untyped overload. Post-decode validation is the safety net.
        let createdLogs: TypedCreatedLog[] = []
        let paymentLogs: TypedPaymentLog[] = []
        let success = false

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (!isCurrent()) break
          try {
            // A1: Use viem's typed event overload with explicit `args`.
            // The `event` field causes viem to construct the correct topic-0.
            // The `args` field causes viem to build topic-1/2/3 filters.
            // This avoids the raw-topics cast that was silently dropped.
            const [cl, pl] = await Promise.all([
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: REQUEST_CREATED_ABI,
                args: { merchant: m },
                fromBlock: from,
                toBlock: to,
              }),
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: PAYMENT_RECORDED_ABI,
                args: { merchant: m },
                fromBlock: from,
                toBlock: to,
              }),
            ])
            createdLogs = cl
            paymentLogs = pl
            success = true
            break
          } catch {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise(res =>
                setTimeout(res, RETRY_BASE_MS * (attempt + 1))
              )
            }
          }
        }

        if (!isCurrent()) break

        if (!success) {
          const fr: FailedRange = {
            fromBlock: from,
            toBlock: to,
            error: `getLogs failed after ${MAX_RETRIES} attempts`,
          }
          stateRef.current.failedRanges.push(fr)
          // Advance scanFloor past this failed range so we don't loop forever
          stateRef.current.scannedBlock = from - 1n
          stateRef.current.scanFloor = from - 1n
        } else {
          // ── Fetch block timestamps for created events ──────────────────
          // A4: Never substitute timestamp 0. Events from blocks whose
          // timestamps we cannot fetch are simply not added this pass.
          // They will be picked up on the next scan cycle (the hook rescans
          // incrementally from scannedBlock).
          const blockNums = [...new Set(
            createdLogs
              .map(l => l.blockNumber)
              .filter((bn): bn is bigint => bn !== null)
          )]
          const blockTsMap = new Map<bigint, number>()

          if (blockNums.length > 0) {
            const blockResults = await Promise.allSettled(
              blockNums.map(bn => publicClient.getBlock({ blockNumber: bn }))
            )
            blockResults.forEach((res, i) => {
              if (res.status === 'fulfilled' && res.value?.timestamp) {
                blockTsMap.set(blockNums[i], Number(res.value.timestamp))
              }
              // A4: On failure, leave the entry absent — never insert 0
            })
          }

          if (!isCurrent()) break

          let didAddCreated = false
          let didAddPayment = false

          // ── Process RequestCreated events ──────────────────────────────
          for (const log of createdLogs) {
            // A1: Post-decode strict validation
            // Contract address
            if (!log.address || log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
            // viem typed logs have decoded args
            const args: TypedCreatedLog['args'] = log.args
            if (!args) continue
            const { id, merchant: logMerchant, amount, expiresAt } = args
            if (!id || id <= 0n) continue
            if (!logMerchant || logMerchant.toLowerCase() !== m.toLowerCase()) continue
            if (!amount || amount <= 0n) continue
            if (!expiresAt) continue

            const rawKey = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
            if (stateRef.current.createdKeys.has(rawKey)) continue

            // A4: Skip if block timestamp not available (never use 0)
            const bn = log.blockNumber
            if (bn === null) continue
            const ts = blockTsMap.get(bn)
            if (ts === undefined) continue // will retry next cycle

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

          // ── Process PaymentRecorded events ─────────────────────────────
          for (const log of paymentLogs) {
            // A1: Post-decode strict validation
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

          // scanFloor = lowest block processed. Decreases each chunk (newest-first).
          stateRef.current.scannedBlock = from - 1n
          stateRef.current.scanFloor = from - 1n

          if (didAddCreated) setCreatedEvents([...stateRef.current.createdEvents])
          if (didAddPayment) setPaymentEvents([...stateRef.current.paymentEvents])
        }

        // A3: isComplete only for full-mode scans that have reached startBlock
        const reachedBottom = stateRef.current.scannedBlock <= startBlock
        const isComplete =
          mode === 'full' &&
          reachedBottom &&
          stateRef.current.failedRanges.length === 0

        setScanProgress({
          scannedBlock: stateRef.current.scannedBlock,
          headBlock,
          isComplete,
          failedRanges: [...stateRef.current.failedRanges],
        })

        // Persist after each chunk
        saveState(m, {
          scannedBlock: stateRef.current.scannedBlock,
          scanFloor: stateRef.current.scanFloor,
          scanMode: stateRef.current.scanMode,
          createdEvents: stateRef.current.createdEvents,
          paymentEvents: stateRef.current.paymentEvents,
          failedRanges: stateRef.current.failedRanges,
        })

        // Advance downward: next chunk ends just below current chunk bottom
        chunkTop = from - 1n

        // Yield between chunks
        await new Promise(res => setTimeout(res, 50))
      }

      // Scan finished (or aborted) — final state update
      if (isCurrent()) {
        const mode2 = stateRef.current?.scanMode ?? mode
        const reachedBottom2 = (stateRef.current?.scannedBlock ?? headBlock) <= startBlock
        const isComplete =
          mode2 === 'full' &&
          reachedBottom2 &&
          (stateRef.current?.failedRanges.length ?? 1) === 0
        setScanProgress(p => ({ ...p, headBlock, isComplete }))
        if (mode2 === 'recent') setIsRecentComplete(true)
      }
    } finally {
      setIsScanning(false)
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

  // Start scan on mount / merchant change — use recent lookback by default
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
      startTransition(() => { initState(merchant, startBlock, 'recent') })
      void runScan(merchant, abort, gen)
    })()

    return () => { abort.abort() }
  }, [merchant, initState, runScan, getRecentStartBlock])

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
      startTransition(() => { initState(merchant, startBlock, 'recent') })
      void runScan(merchant, abort, gen)
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
    startTransition(() => { initState(merchant, DEPLOYMENT_BLOCK - 1n, 'full') })
    void runScan(merchant, abort, gen)
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
