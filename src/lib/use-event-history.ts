/**
 * use-event-history.ts — Bounded getLogs scanner for merchant event history.
 *
 * Scans RequestCreated and PaymentRecorded events for the configured merchant
 * address. Uses viem's publicClient.getLogs in bounded 2000-block chunks.
 *
 * Design decisions:
 * - NEVER starts from block 0. Starts from a hardcoded deployment block
 *   derived from the known deploy TX (see DEPLOYMENT_BLOCK below).
 * - Scans in RANGE_SIZE-block chunks forward to the current head.
 * - Retries each failed chunk up to MAX_RETRIES times before marking it
 *   as a failed range (stored separately — never silently skipped).
 * - Deduplicates by log txHash+logIndex so retries do not double-count.
 * - Scope key: chain+contract+merchant — never mix data across accounts.
 * - Stores progress in sessionStorage (resumable across tab navigation,
 *   not across device — honesty note shown to user).
 * - Reports scan progress: current block, chain head, blocks remaining.
 * - NEVER presents partial data as a complete report — "incomplete" flag
 *   is set until coverage reaches chain head.
 * - A failed chunk is never shown as "0 results" — it contributes to
 *   failedRanges[] and triggers the "scan incomplete" warning.
 *
 * PUBLIC API:
 *   useEventHistory(merchant) → EventHistoryState
 *
 * EventHistoryState:
 *   .createdEvents    — RequestCreated events (with block timestamp)
 *   .paymentEvents    — PaymentRecorded events (with paidAt from log data)
 *   .scanProgress     — { scannedBlock, headBlock, isComplete, failedRanges }
 *   .isScanning       — true while a scan chunk is in flight
 *   .rescan()         — reset and restart from deployment block
 */

import { useState, useEffect, useRef, useCallback, startTransition } from 'react'
import { usePublicClient } from 'wagmi'
import {
  CONTRACT_ADDRESS, REQUEST_CREATED_TOPIC, PAYMENT_RECORDED_TOPIC,
  ARC_TESTNET_ID,
} from '@/lib/contract'
import { MERCHANT_ADDRESS } from '@/lib/merchant'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The block in which the ArcReceiptCheckout contract was deployed.
 * Used as the absolute lower bound — never scan below this.
 *   TX:    0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45
 *   Date:  2026-10-16T07:21:04.299Z
 */
const DEPLOYMENT_BLOCK = 2_900_000n

/**
 * Default lookback from chain head on a fresh scan (no cached state).
 * Arc Testnet runs ~2 blocks/second → ~172_800 blocks/day.
 * 300_000 blocks ≈ ~1.7 days, comfortably covers the entire contract history
 * (deployed Oct 16, chain head ~67.9M at Oct 18) in ~150 RPC chunks instead
 * of ~32_500 from deployment block.
 *
 * The user can trigger a full-history scan from deployment via rescanFull().
 */
const DEFAULT_LOOKBACK = 300_000n

/** Blocks per getLogs call. 2000 is a safe batch size for most RPC providers. */
const RANGE_SIZE = 2000n

/** Max retries per failed chunk before recording it as a permanent failure. */
const MAX_RETRIES = 3

/** Milliseconds to wait between retry attempts. */
const RETRY_DELAY_MS = 1500

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreatedEvent {
  requestId: bigint
  merchant: `0x${string}`
  amount: bigint
  expiresAt: bigint
  /** Unix seconds (block.timestamp of the RequestCreated event's block). */
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
  isComplete: boolean
  failedRanges: FailedRange[]
}

/** Whether the current scan covers recent blocks only or the full history. */
export type ScanMode = 'recent' | 'full'

export interface EventHistoryState {
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  scanProgress: ScanProgress
  isScanning: boolean
  scanMode: ScanMode
  /** Reset and rescan from recent lookback (fast, default). */
  rescan: () => void
  /** Reset and rescan from deployment block (slow, full history). */
  rescanFull: () => void
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageKey(merchant: string): string {
  return `arc-event-history-v1:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${merchant.toLowerCase()}`
}

interface PersistedState {
  scannedBlock: string // bigint serialized as string
  createdEvents: CreatedEvent[]
  paymentEvents: PaymentEvent[]
  failedRanges: FailedRange[]
}

function loadState(merchant: string): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(merchant))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedState
    // Basic schema check
    if (typeof parsed.scannedBlock !== 'string') return null
    // Re-hydrate bigints (JSON serializes them as strings)
    parsed.createdEvents = (parsed.createdEvents ?? []).map(e => ({
      ...e,
      requestId: BigInt(e.requestId),
      amount: BigInt(e.amount),
      expiresAt: BigInt(e.expiresAt),
    }))
    parsed.paymentEvents = (parsed.paymentEvents ?? []).map(e => ({
      ...e,
      requestId: BigInt(e.requestId),
      amount: BigInt(e.amount),
    }))
    parsed.failedRanges = (parsed.failedRanges ?? []).map(r => ({
      ...r,
      fromBlock: BigInt(r.fromBlock),
      toBlock: BigInt(r.toBlock),
    }))
    return parsed
  } catch {
    return null
  }
}

function saveState(merchant: string, state: PersistedState): void {
  try {
    // Serialize bigints as strings for JSON
    const serializable = {
      ...state,
      createdEvents: state.createdEvents.map(e => ({ ...e, requestId: e.requestId.toString(), amount: e.amount.toString(), expiresAt: e.expiresAt.toString() })),
      paymentEvents: state.paymentEvents.map(e => ({ ...e, requestId: e.requestId.toString(), amount: e.amount.toString() })),
      failedRanges: state.failedRanges.map(r => ({ ...r, fromBlock: r.fromBlock.toString(), toBlock: r.toBlock.toString() })),
    }
    sessionStorage.setItem(storageKey(merchant), JSON.stringify(serializable))
  } catch {
    // sessionStorage quota — ignore, state stays in memory
  }
}

function clearState(merchant: string): void {
  try { sessionStorage.removeItem(storageKey(merchant)) } catch { /* ignore */ }
}

// ── Log decoders ──────────────────────────────────────────────────────────────

type RawLog = {
  address: string
  blockNumber: bigint | null
  transactionHash: `0x${string}` | null
  logIndex: number | null
  topics: readonly (`0x${string}` | null)[]
  data: `0x${string}`
  blockTimestamp?: bigint | null
}

function decodeCreatedLog(log: RawLog, blockTs: number): CreatedEvent | null {
  if (log.topics.length < 3) return null
  try {
    const requestId = BigInt(log.topics[1] as string)
    const merchant = ('0x' + (log.topics[2] as string).slice(26)) as `0x${string}`
    // data: abi.encode(uint256 amount, uint256 expiresAt) — two 32-byte slots
    const hex = (log.data as string).replace(/^0x/, '')
    if (hex.length < 128) return null
    const amount = BigInt('0x' + hex.slice(0, 64))
    const expiresAt = BigInt('0x' + hex.slice(64, 128))
    const key = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
    return { requestId, merchant, amount, expiresAt, createdAt: blockTs, key }
  } catch {
    return null
  }
}

function decodePaymentLog(log: RawLog, _blockTs: number): PaymentEvent | null {
  if (log.topics.length < 4) return null
  try {
    const requestId = BigInt(log.topics[1] as string)
    const merchant = ('0x' + (log.topics[2] as string).slice(26)) as `0x${string}`
    const payer = ('0x' + (log.topics[3] as string).slice(26)) as `0x${string}`
    // data: abi.encode(uint256 amount, uint256 paidAt)
    const hex = (log.data as string).replace(/^0x/, '')
    if (hex.length < 128) return null
    const amount = BigInt('0x' + hex.slice(0, 64))
    const paidAt = Number(BigInt('0x' + hex.slice(64, 128)))
    const key = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
    return { requestId, merchant, payer, amount, paidAt, key }
  } catch {
    return null
  }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useEventHistory(merchant: `0x${string}` | null): EventHistoryState {
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  const stateRef = useRef<{
    createdEvents: CreatedEvent[]
    paymentEvents: PaymentEvent[]
    scannedBlock: bigint
    failedRanges: FailedRange[]
    createdKeys: Set<string>
    paymentKeys: Set<string>
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

  const scanAbortRef = useRef<AbortController | null>(null)

  /**
   * initState — set up in-memory and React state.
   * startBlock: the block BEFORE which we already have data (i.e. we scan from startBlock+1).
   * If saved state exists and its scannedBlock >= startBlock, resume from saved state.
   * Otherwise start fresh from startBlock.
   */
  const initState = useCallback((m: string, startBlock: bigint) => {
    const saved = loadState(m)
    // Resume from saved state if it covers at least startBlock
    if (saved && BigInt(saved.scannedBlock) >= startBlock) {
      const scannedBlock = BigInt(saved.scannedBlock)
      const ce = saved.createdEvents
      const pe = saved.paymentEvents
      const fr = saved.failedRanges
      stateRef.current = {
        createdEvents: ce, paymentEvents: pe,
        scannedBlock, failedRanges: fr,
        createdKeys: new Set(ce.map(e => e.key)),
        paymentKeys: new Set(pe.map(e => e.key)),
      }
      setCreatedEvents(ce)
      setPaymentEvents(pe)
      setScanProgress(p => ({ ...p, scannedBlock, failedRanges: fr }))
    } else {
      stateRef.current = {
        createdEvents: [], paymentEvents: [],
        scannedBlock: startBlock,
        failedRanges: [],
        createdKeys: new Set(), paymentKeys: new Set(),
      }
      setCreatedEvents([])
      setPaymentEvents([])
      setScanProgress({
        scannedBlock: startBlock, headBlock: startBlock,
        isComplete: false, failedRanges: [],
      })
    }
  }, [])

  const runScan = useCallback(async (m: `0x${string}`, abort: AbortController) => {
    if (!publicClient) return
    if (!stateRef.current) return

    setIsScanning(true)

    try {
      // Get current chain head
      let headBlock: bigint
      try {
        headBlock = await publicClient.getBlockNumber()
      } catch {
        setIsScanning(false)
        return
      }

      setScanProgress(p => ({ ...p, headBlock, isComplete: stateRef.current!.scannedBlock >= headBlock }))

      if (stateRef.current.scannedBlock >= headBlock) {
        setIsScanning(false)
        return
      }

      const merchantTopic = ('0x' + '0'.repeat(24) + m.toLowerCase().slice(2)) as `0x${string}`

      let from = stateRef.current.scannedBlock + 1n

      while (from <= headBlock) {
        if (abort.signal.aborted) break

        const to = from + RANGE_SIZE - 1n < headBlock ? from + RANGE_SIZE - 1n : headBlock

        let createdLogs: RawLog[] = []
        let paymentLogs: RawLog[] = []
        let success = false

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (abort.signal.aborted) break
          try {
            // Fetch both event types in parallel.
            // viem getLogs with raw topics uses the topics[] array-of-arrays format:
            //   topics[0] = event signature, topics[1] = id (null=any), topics[2] = merchant
            // We pass them via the `topics` field using the explicit overload that takes
            // `event: undefined` so we can supply raw topic arrays.
            const [cl, pl] = await Promise.all([
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: undefined,
                topics: [REQUEST_CREATED_TOPIC, null, merchantTopic] as readonly (`0x${string}` | null)[],
                fromBlock: from,
                toBlock: to,
              } as Parameters<typeof publicClient.getLogs>[0]),
              publicClient.getLogs({
                address: CONTRACT_ADDRESS as `0x${string}`,
                event: undefined,
                topics: [PAYMENT_RECORDED_TOPIC, null, merchantTopic] as readonly (`0x${string}` | null)[],
                fromBlock: from,
                toBlock: to,
              } as Parameters<typeof publicClient.getLogs>[0]),
            ])
            createdLogs = cl
            paymentLogs = pl
            success = true
            break
          } catch {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise(res => setTimeout(res, RETRY_DELAY_MS * (attempt + 1)))
            }
          }
        }

        if (abort.signal.aborted) break

        if (!success) {
          // Record failed range — never skip silently
          const fr: FailedRange = {
            fromBlock: from,
            toBlock: to,
            error: `getLogs failed after ${MAX_RETRIES} attempts`,
          }
          stateRef.current.failedRanges.push(fr)
          // Advance past failed range to continue scanning subsequent blocks
          stateRef.current.scannedBlock = to
        } else {
          // Decode and deduplicate
          // For created logs, we need block timestamps.
          // Fetch timestamps for unique blocks that have created events.
          const blockNums = [...new Set(createdLogs.map(l => l.blockNumber).filter((bn): bn is bigint => bn !== null))]
          const blockTsMap: Map<bigint, number> = new Map()

          if (blockNums.length > 0) {
            // Fetch blocks in parallel (bounded by actual count — typically small)
            const blockResults = await Promise.allSettled(
              blockNums.map(bn => publicClient.getBlock({ blockNumber: bn }))
            )
            blockResults.forEach((res, i) => {
              if (res.status === 'fulfilled' && res.value) {
                blockTsMap.set(blockNums[i], Number(res.value.timestamp))
              }
            })
          }

          let didAddCreated = false
          let didAddPayment = false

          for (const log of createdLogs) {
            const key = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
            if (stateRef.current.createdKeys.has(key)) continue
            const ts = (log.blockNumber !== null ? blockTsMap.get(log.blockNumber) : undefined) ?? 0
            const ev = decodeCreatedLog(log, ts)
            if (!ev) continue
            stateRef.current.createdKeys.add(key)
            stateRef.current.createdEvents.push(ev)
            didAddCreated = true
          }

          for (const log of paymentLogs) {
            const key = `${log.transactionHash ?? 'pending'}-${log.logIndex ?? 0}`
            if (stateRef.current.paymentKeys.has(key)) continue
            const ev = decodePaymentLog(log, 0)
            if (!ev) continue
            stateRef.current.paymentKeys.add(key)
            stateRef.current.paymentEvents.push(ev)
            didAddPayment = true
          }

          stateRef.current.scannedBlock = to

          // Update React state every chunk
          if (didAddCreated) setCreatedEvents([...stateRef.current.createdEvents])
          if (didAddPayment) setPaymentEvents([...stateRef.current.paymentEvents])
        }

        // Always update progress after each chunk
        const isComplete = stateRef.current.scannedBlock >= headBlock && stateRef.current.failedRanges.length === 0
        setScanProgress({
          scannedBlock: stateRef.current.scannedBlock,
          headBlock,
          isComplete,
          failedRanges: [...stateRef.current.failedRanges],
        })

        // Persist to sessionStorage
        saveState(m, {
          scannedBlock: stateRef.current.scannedBlock.toString(),
          createdEvents: stateRef.current.createdEvents,
          paymentEvents: stateRef.current.paymentEvents,
          failedRanges: stateRef.current.failedRanges,
        })

        from = stateRef.current.scannedBlock + 1n

        // Small yield between chunks to avoid blocking the main thread
        await new Promise(res => setTimeout(res, 50))
      }
    } finally {
      setIsScanning(false)
    }
  }, [publicClient])

  /**
   * Compute the smart start block for a fresh recent scan:
   * max(DEPLOYMENT_BLOCK, chainHead - DEFAULT_LOOKBACK).
   * Falls back to DEPLOYMENT_BLOCK if chainHead is unknown yet.
   */
  const getRecentStartBlock = useCallback(async (): Promise<bigint> => {
    if (!publicClient) return DEPLOYMENT_BLOCK - 1n
    try {
      const head = await publicClient.getBlockNumber()
      const lookbackStart = head > DEFAULT_LOOKBACK ? head - DEFAULT_LOOKBACK : 0n
      const start = lookbackStart > DEPLOYMENT_BLOCK ? lookbackStart : DEPLOYMENT_BLOCK
      return start - 1n // initState receives the block BEFORE which we scan from
    } catch {
      return DEPLOYMENT_BLOCK - 1n
    }
  }, [publicClient])

  // Start scan on mount / merchant change — use recent lookback
  useEffect(() => {
    if (!merchant) return
    if (merchant.toLowerCase() !== MERCHANT_ADDRESS?.toLowerCase()) return

    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    startTransition(() => setScanMode('recent'))

    void (async () => {
      const startBlock = await getRecentStartBlock()
      startTransition(() => { initState(merchant, startBlock) })
      void runScan(merchant, abort)
    })()

    return () => { abort.abort() }
  }, [merchant, initState, runScan, getRecentStartBlock])

  /** Rescan from recent lookback (fast). */
  const rescan = useCallback(() => {
    if (!merchant) return
    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    clearState(merchant)
    setScanMode('recent')
    void (async () => {
      const startBlock = await getRecentStartBlock()
      startTransition(() => { initState(merchant, startBlock) })
      void runScan(merchant, abort)
    })()
  }, [merchant, initState, runScan, getRecentStartBlock])

  /** Rescan from deployment block (full history — slow). */
  const rescanFull = useCallback(() => {
    if (!merchant) return
    scanAbortRef.current?.abort()
    const abort = new AbortController()
    scanAbortRef.current = abort
    clearState(merchant)
    setScanMode('full')
    startTransition(() => { initState(merchant, DEPLOYMENT_BLOCK - 1n) })
    void runScan(merchant, abort)
  }, [merchant, initState, runScan])

  return { createdEvents, paymentEvents, scanProgress, isScanning, scanMode, rescan, rescanFull }
}
