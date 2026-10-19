/**
 * MyReceipts — §6 of the implementation spec.
 *
 * Part 1 corrections:
 * - A1: getLogs now uses viem's TYPED event overload with payer in args,
 *       replacing the raw-topics cast that viem silently dropped.
 *       Post-decode validation still cross-checks payer/merchant/amount.
 * - A2: DEPLOYMENT_BLOCK from deployment.ts (67,462,931) — not hardcoded.
 * - Cache schema version bumped (v2); v1 entries are evicted on load.
 *
 * Scans PaymentRecorded events from deployment block forward, filtering
 * by the connected payer address, in 2,000-block chunks.
 *
 * Data honesty:
 * - Never claims complete history until scan reaches chain head.
 * - Failed/error chunks do not clear known results.
 * - Wallet change clears displayed history; shared receipt links always work.
 * - No phone auth, no cross-wallet profiles, no personal data stored.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { ExternalLink, RefreshCw, Loader2, Receipt, AlertCircle } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, ARC_TESTNET_ID,
} from '@/lib/contract'
import { ARC_TESTNET_DEPLOYMENT } from '@/lib/deployment'
import { formatAddr, formatTs } from '@/lib/ui'

// A2: Deployment block from the single verified source
const DEPLOYMENT_BLOCK = ARC_TESTNET_DEPLOYMENT.block
const CHUNK_SIZE = 2_000n
const CACHE_VERSION = 2

// A1: Typed ABI event — viem builds topic-0 and indexed-field filters correctly
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

function storageKey(chainId: number, contract: string, payer: string): string {
  return `arc-receipt:my-receipts-v${CACHE_VERSION}:${chainId}:${contract.toLowerCase()}:${payer.toLowerCase()}`
}

/** Evict any v1 cache for this payer. */
function evictOldCache(chainId: number, contract: string, payer: string): void {
  try {
    const v1 = `arc-receipt:my-receipts:${chainId}:${contract.toLowerCase()}:${payer.toLowerCase()}`
    sessionStorage.removeItem(v1)
  } catch { /* ignore */ }
}

function validateRecord(r: unknown): r is { id: string; merchant: string; payer: string; amount: string; paidAt: string; txHash: string; blockNumber: string } {
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

function loadCache(chainId: number, contract: string, payer: string): {
  records: PaymentRecord[]
  scannedTo: bigint
} | null {
  evictOldCache(chainId, contract, payer)
  try {
    const raw = sessionStorage.getItem(storageKey(chainId, contract, payer))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; records: unknown[]; scannedTo: string }
    if (parsed.version !== CACHE_VERSION) return null
    const scannedTo = BigInt(parsed.scannedTo)
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
    return { records, scannedTo }
  } catch { return null }
}

function saveCache(
  chainId: number, contract: string, payer: string,
  records: PaymentRecord[], scannedTo: bigint
): void {
  try {
    sessionStorage.setItem(storageKey(chainId, contract, payer), JSON.stringify({
      version: CACHE_VERSION,
      records: records.map(r => ({
        id: r.id.toString(),
        merchant: r.merchant,
        payer: r.payer,
        amount: r.amount.toString(),
        paidAt: r.paidAt.toString(),
        txHash: r.txHash,
        blockNumber: r.blockNumber.toString(),
      })),
      scannedTo: scannedTo.toString(),
    }))
  } catch { /* storage full */ }
}

export function MyReceipts() {
  const { address, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  const [records, setRecords]       = useState<PaymentRecord[]>([])
  const [scannedTo, setScannedTo]   = useState<bigint | null>(null)
  const [chainHead, setChainHead]   = useState<bigint | null>(null)
  const [scanning, setScanning]     = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [complete, setComplete]     = useState(false)

  const abortRef    = useRef(false)
  const scanningRef = useRef(false)

  const runScan = useCallback(async (payer: `0x${string}`, fromBlock: bigint) => {
    if (!publicClient || scanningRef.current) return
    scanningRef.current = true
    abortRef.current = false
    setScanning(true)
    setError(null)

    try {
      const head = await publicClient.getBlockNumber()
      setChainHead(head)

      let cursor = fromBlock
      const accumulated: PaymentRecord[] = []

      while (cursor <= head && !abortRef.current) {
        const to = cursor + CHUNK_SIZE - 1n < head ? cursor + CHUNK_SIZE - 1n : head
        let chunkOk = false

        // Try full chunk; on failure retry with half the range
        for (const [cFrom, cTo] of [[cursor, to], [cursor, cursor + CHUNK_SIZE / 2n - 1n < head ? cursor + CHUNK_SIZE / 2n - 1n : head]] as [bigint, bigint][]) {
          try {
            // A1: Typed event + args-based payer filter
            const logs = await publicClient.getLogs({
              address: CONTRACT_ADDRESS as `0x${string}`,
              event: PAYMENT_RECORDED_ABI,
              args: { payer },
              fromBlock: cFrom,
              toBlock: cTo,
            })

            for (const log of logs) {
              // A1: Post-decode strict validation
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

              accumulated.push({
                id,
                merchant: merchant.toLowerCase(),
                payer: logPayer.toLowerCase(),
                amount,
                paidAt,
                txHash: log.transactionHash ?? '',
                blockNumber: log.blockNumber ?? 0n,
              })
            }

            setScannedTo(cTo)
            if (cTo < to) {
              // Used half-chunk; advance by half
              cursor = cTo + 1n
            } else {
              cursor = to + 1n
            }
            chunkOk = true
            break
          } catch {
            if (cFrom === cursor && cTo === to) {
              // Full chunk failed; will try half next iteration
              continue
            }
            // Half chunk also failed
            const msg = 'Network error — partial scan paused'
            setRecords(prev => {
              const merged = dedup([...prev, ...accumulated])
              saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer, merged, cursor - 1n)
              return merged
            })
            setError(msg)
            scanningRef.current = false
            setScanning(false)
            return
          }
        }

        if (!chunkOk) {
          const msg = 'Network error — partial scan paused'
          setRecords(prev => {
            const merged = dedup([...prev, ...accumulated])
            saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer, merged, cursor - 1n)
            return merged
          })
          setError(msg)
          scanningRef.current = false
          setScanning(false)
          return
        }
      }

      if (!abortRef.current) {
        setRecords(prev => {
          const merged = dedup([...prev, ...accumulated])
          saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer, merged, head)
          return merged
        })
        setScannedTo(head)
        setComplete(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 120) : 'Scan failed')
    } finally {
      scanningRef.current = false
      setScanning(false)
    }
  }, [publicClient])

  // Start / restart scan when address changes
  useEffect(() => {
    abortRef.current = true
    setComplete(false)
    setError(null)

    if (!address || chainId !== ARC_TESTNET_ID) {
      setRecords([])
      setScannedTo(null)
      setChainHead(null)
      return
    }

    const cached = loadCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, address)
    if (cached) {
      setRecords(cached.records)
      setScannedTo(cached.scannedTo)
      void runScan(address, cached.scannedTo + 1n)
    } else {
      setRecords([])
      void runScan(address, DEPLOYMENT_BLOCK)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId])

  const handleRefresh = useCallback(() => {
    if (!address || scanning) return
    sessionStorage.removeItem(storageKey(ARC_TESTNET_ID, CONTRACT_ADDRESS, address))
    setRecords([])
    setScannedTo(null)
    setComplete(false)
    void runScan(address, DEPLOYMENT_BLOCK)
  }, [address, scanning, runScan])

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

  const progress = chainHead !== null && scannedTo !== null
    ? `Block ${scannedTo.toString()} / ${chainHead.toString()}`
    : null

  const remaining = chainHead !== null && scannedTo !== null
    ? chainHead - scannedTo
    : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Payments made by</p>
          <p className="text-xs font-mono text-slate-500">{formatAddr(address)}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs font-medium text-slate-700 transition-colors"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {/* Scan progress */}
      {(scanning || (!complete && scannedTo !== null)) && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500 space-y-1">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className={scanning ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
            <span className="font-medium">
              {complete
                ? 'Scan complete'
                : scanning
                ? 'Scanning for payments…'
                : 'Partial scan — tap Refresh to continue'}
            </span>
          </div>
          {progress && (
            <p>{progress}
              {remaining !== null && remaining > 0n && ` (${remaining.toString()} blocks remaining)`}
            </p>
          )}
          <p className="text-slate-400">
            Starting from deployment block {DEPLOYMENT_BLOCK.toString()}.
            {!complete && ' History may be incomplete until scan finishes.'}
          </p>
        </div>
      )}

      {error && records.length === 0 ? (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-500" />
            <div>
              <p className="text-sm font-medium text-rose-700">Unable to load payment history</p>
              <p className="text-xs text-rose-600 mt-0.5">{error}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={scanning}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-rose-100 hover:bg-rose-200 disabled:opacity-50 text-sm font-semibold text-rose-700 transition-colors"
          >
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : (
        <>
          {error && records.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-700">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">Scan paused — partial results shown</p>
                <p className="truncate">{error}</p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={scanning}
                className="shrink-0 flex items-center gap-1 text-amber-700 hover:text-amber-900 font-medium disabled:opacity-50"
              >
                <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} /> Retry
              </button>
            </div>
          )}

          <p className="text-xs text-slate-400">
            History belongs to this wallet. Switching wallets changes the displayed history.
            Shared receipt links always work without a wallet.
          </p>

          {records.length === 0 && !scanning ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-1">
              <p className="text-sm font-semibold text-slate-600">
                {complete ? 'No payments found' : 'No payments found yet'}
              </p>
              <p className="text-xs text-slate-400">
                {complete
                  ? 'This wallet has not paid any requests through ArcReceipt.'
                  : 'Scan in progress — results will appear as blocks are scanned.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((rec) => (
                <PaymentRecordRow key={rec.txHash || rec.id.toString()} rec={rec} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function dedup(records: PaymentRecord[]): PaymentRecord[] {
  return records
    .filter((r, i, arr) => arr.findIndex(x => x.txHash === r.txHash && x.id === r.id) === i)
    .sort((a, b) => Number(b.blockNumber - a.blockNumber))
}

function PaymentRecordRow({ rec }: { rec: PaymentRecord }) {
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
      {rec.txHash && (
        <a
          href={explorerUrl}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
        >
          <ExternalLink size={11} /> View transaction
        </a>
      )}
    </div>
  )
}
