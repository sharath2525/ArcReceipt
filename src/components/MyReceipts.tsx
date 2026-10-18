/**
 * MyReceipts — §6 of the implementation spec.
 *
 * Scans PaymentRecorded events from the contract deployment block
 * (67,462,931) for the connected payer address, using eth_getLogs
 * with the `payer` topic filter (3rd indexed field).
 *
 * Design decisions:
 * - Starts from deployment block — never claims history before that.
 * - Fetches in 2,000-block chunks to respect provider limits.
 * - Caches results by chainId + contract + payer in sessionStorage.
 * - Progress shown: current block scanned / chain head / remaining.
 * - Distinguishes "scanning" from "complete" — never claims full
 *   history until scan reaches chain head.
 * - Wallet change clears the displayed history. Shared receipt links
 *   always work independently of wallet connection.
 * - No phone auth, no cross-wallet profiles, no personal data stored.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { type Log } from 'viem'
import { ExternalLink, RefreshCw, Loader2, Receipt, AlertCircle } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, ARC_TESTNET_ID, PAYMENT_RECORDED_TOPIC,
} from '@/lib/contract'
import { formatAddr, formatTs } from '@/lib/ui'

// Contract deployment block — scan starts here, never from 0.
const DEPLOYMENT_BLOCK = 67_462_931n
const CHUNK_SIZE = 2_000n

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
  return `arc-receipt:my-receipts:${chainId}:${contract.toLowerCase()}:${payer.toLowerCase()}`
}

function loadCache(chainId: number, contract: string, payer: string): {
  records: PaymentRecord[]
  scannedTo: bigint
} | null {
  try {
    const raw = sessionStorage.getItem(storageKey(chainId, contract, payer))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { records: unknown[]; scannedTo: string }
    return {
      records: (parsed.records as PaymentRecord[]).map(r => ({
        ...r,
        id: BigInt(r.id),
        amount: BigInt(r.amount),
        paidAt: BigInt(r.paidAt),
        blockNumber: BigInt(r.blockNumber),
      })),
      scannedTo: BigInt(parsed.scannedTo),
    }
  } catch { return null }
}

function saveCache(chainId: number, contract: string, payer: string, records: PaymentRecord[], scannedTo: bigint) {
  try {
    sessionStorage.setItem(storageKey(chainId, contract, payer), JSON.stringify({
      records: records.map(r => ({ ...r, id: r.id.toString(), amount: r.amount.toString(), paidAt: r.paidAt.toString(), blockNumber: r.blockNumber.toString() })),
      scannedTo: scannedTo.toString(),
    }))
  } catch { /* storage full */ }
}

function decodePaymentLog(log: Log, expectedPayer: string): PaymentRecord | null {
  try {
    // PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)
    // topics[0] = event sig, topics[1] = id, topics[2] = merchant, topics[3] = payer
    // data = abi.encode(amount, paidAt)
    if (!log.topics || log.topics.length < 4) return null
    // Validate event signature matches the expected topic-0
    if ((log.topics[0] as string).toLowerCase() !== PAYMENT_RECORDED_TOPIC.toLowerCase()) return null
    const id = BigInt(log.topics[1] as string)
    const merchant = ('0x' + (log.topics[2] as string).slice(26)).toLowerCase()
    const payer = ('0x' + (log.topics[3] as string).slice(26)).toLowerCase()
    // Validate decoded payer matches the connected wallet — prevents another
    // wallet's payments appearing in this view if the topic filter is ignored
    // by the RPC provider or the cast is incorrect.
    if (payer !== expectedPayer.toLowerCase()) return null
    const data = log.data
    const amount = BigInt('0x' + data.slice(2, 66))
    const paidAt = BigInt('0x' + data.slice(66, 130))
    // Sanity-check: amount and paidAt must be plausible
    if (amount === 0n) return null
    return {
      id, merchant, payer, amount, paidAt,
      txHash: log.transactionHash ?? '',
      blockNumber: log.blockNumber ?? 0n,
    }
  } catch { return null }
}

// Encode payer address as a 32-byte topic filter value
function payerTopic(address: string): string {
  return '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0')
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

  const abortRef = useRef(false)
  const scanningRef = useRef(false)

  const runScan = useCallback(async (payer: string, fromBlock: bigint) => {
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
        try {
          const logs = await publicClient.getLogs({
            address: CONTRACT_ADDRESS as `0x${string}`,
            // topics: [sig, id=any, merchant=any, payer=specific]
            // Cast needed because viem's typed getLogs only accepts event/args
            // for typed filtering; raw topic arrays require the cast.
            ...({ topics: [PAYMENT_RECORDED_TOPIC, null, null, payerTopic(payer)] } as object),
            fromBlock: cursor,
            toBlock: to,
          })
          for (const log of logs) {
            const rec = decodePaymentLog(log, payer)
            if (rec) accumulated.push(rec)
          }
          setScannedTo(to)
        } catch (e) {
          // On chunk error, retry once with half the chunk size
          const half = CHUNK_SIZE / 2n
          const midTo = cursor + half - 1n < head ? cursor + half - 1n : head
          try {
            const logs = await publicClient.getLogs({
              address: CONTRACT_ADDRESS as `0x${string}`,
              ...({ topics: [PAYMENT_RECORDED_TOPIC, null, null, payerTopic(payer)] } as object),
              fromBlock: cursor,
              toBlock: midTo,
            })
            for (const log of logs) {
              const rec = decodePaymentLog(log, payer)
              if (rec) accumulated.push(rec)
            }
            setScannedTo(midTo)
            cursor = midTo + 1n
            continue
          } catch {
            const msg = e instanceof Error ? e.message.slice(0, 120) : 'Network error'
            // Use ref so we merge with whatever records are actually in state now,
            // not a stale closure snapshot from when runScan was created.
            setRecords(prev => {
              const merged = [...prev, ...accumulated]
                .filter((r, i, arr) => arr.findIndex(x => x.txHash === r.txHash) === i)
                .sort((a, b) => Number(b.blockNumber - a.blockNumber))
              saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer, merged, cursor - 1n)
              return merged
            })
            setError(msg)
            scanningRef.current = false
            setScanning(false)
            return
          }
        }
        cursor = to + 1n
      }

      if (!abortRef.current) {
        setRecords(prev => {
          const final = [...prev, ...accumulated]
            .filter((r, i, arr) => arr.findIndex(x => x.txHash === r.txHash) === i)
            .sort((a, b) => Number(b.blockNumber - a.blockNumber))
          saveCache(ARC_TESTNET_ID, CONTRACT_ADDRESS, payer, final, head)
          return final
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
    abortRef.current = true  // cancel any ongoing scan
    setComplete(false)
    setError(null)

    if (!address || chainId !== ARC_TESTNET_ID) {
      setRecords([])
      setScannedTo(null)
      setChainHead(null)
      return
    }

    // Load cached results and continue from last scanned block
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
    // Clear cache and rescan from deployment block
    sessionStorage.removeItem(storageKey(ARC_TESTNET_ID, CONTRACT_ADDRESS, address))
    setRecords([])
    setScannedTo(null)
    setComplete(false)
    void runScan(address, DEPLOYMENT_BLOCK)
  }, [address, scanning, runScan])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-2">
        <Receipt size={24} className="mx-auto text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">Connect your wallet</p>
        <p className="text-xs text-slate-400">My Receipts shows payments made by your connected wallet.</p>
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
              {complete ? 'Scan complete' : scanning ? 'Scanning for payments…' : 'Partial scan — tap Refresh to continue'}
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

      {/* Error state — mutually exclusive with the empty "no results" card.
          When an error is set and there are no previously-loaded records,
          show a single actionable card rather than contradictory messages.
          When partial records were loaded before the error, keep them visible
          above the retry banner so the user doesn't lose what was already found. */}
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
          {/* Non-fatal error with partial results — show inline banner above results */}
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

          {/* Disclaimer */}
          <p className="text-xs text-slate-400">
            History belongs to this wallet. Switching wallets changes the displayed history.
            Shared receipt links always work without a wallet.
          </p>

          {/* Results */}
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
                <PaymentRecordRow key={rec.txHash} rec={rec} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
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
              {formatUsdc(rec.amount)} <span className="text-xs font-normal text-slate-400">USDC</span>
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
      <a
        href={explorerUrl}
        target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
      >
        <ExternalLink size={11} /> View transaction
      </a>
    </div>
  )
}
