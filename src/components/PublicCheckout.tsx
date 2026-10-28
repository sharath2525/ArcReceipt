/**
 * PublicCheckout — Part 1 + Stage-1 revision
 *
 * Stage 1 additions:
 *   - Payment evidence: onPaid() only fires when the confirmed receipt
 *     contains a PaymentRecorded event matching (id, merchant, amount, payer).
 *     A replacement/repriced TX that succeeded without the expected event
 *     is treated as unresolved: the TX hash is shown with an explorer link
 *     but success is NOT claimed. Authoritative contract state is re-read
 *     after every confirmed receipt.
 *   - reportedHash ref is reset on requestId change so navigating
 *     A→B cannot carry hash-A's success guard into request B.
 *   - Stale account guard: the wallet address at submission time is
 *     captured in the onSuccess closure; if the wallet changes before
 *     confirmation the result is discarded.
 *
 * Part 1 additions (B — preserved):
 *   - Persists approveHash + payHash to sessionStorage keyed by
 *     chainId + contract + account + requestId. Restores on refresh.
 *   - Checks current USDC allowance; skips approve when already sufficient.
 *   - phase persisted (restore to 'paying' after approve confirmed).
 *
 * Day 3 fixes (preserved):
 *   - Single useWriteContract hook prevents duplicate wallet requests.
 *   - walletBusy guard spans both phases.
 *   - Rejection clears write hook without discarding hash.
 *   - chain-pinned watchers with confirmations:1.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useSwitchChain, useReadContract,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { TokenUSDC } from '@web3icons/react'
import {
  CheckCircle, AlertCircle, Loader2, ExternalLink, Clock, ArrowRight, ShieldCheck, Copy, RefreshCw,
} from 'lucide-react'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID, PAYMENT_RECORDED_TOPIC,
  type OnchainRequest,
} from '@/lib/contract'
import { formatAddr, formatTs, isExpired } from '@/lib/ui'

/**
 * Validate that a confirmed receipt contains a PaymentRecorded event for the
 * expected (requestId, merchant, amount, payer).
 *
 * Returns the matched TX hash from the receipt if valid, or null if:
 *   - The contract address in the log does not match.
 *   - topic-0 does not match PAYMENT_RECORDED_TOPIC.
 *   - The decoded id, merchant, amount or payer do not match the expected values.
 *   - Any log field required for validation is absent.
 *
 * "Amount" is validated against the onchain req.amount — the contract always
 * transfers exactly the stored amount, so a mismatch means a different request
 * or an unexpected repricing (neither should be possible on a valid pay() call).
 */
function validatePaymentReceipt(
  receipt: { logs: Array<{ address: string; topics: readonly (string | null)[]; data: string }> },
  requestId: bigint,
  req: OnchainRequest,
  payerAddress: string
): boolean {
  const wantTopic = PAYMENT_RECORDED_TOPIC.toLowerCase()
  for (const log of receipt.logs) {
    // Must come from the correct contract
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
    // topic-0 must match PaymentRecorded
    if (typeof log.topics[0] !== 'string') continue
    if (log.topics[0].toLowerCase() !== wantTopic) continue

    // topic-1 = indexed id (uint256 padded to 32 bytes)
    const idTopic = log.topics[1]
    if (!idTopic) continue
    try {
      const logId = BigInt(idTopic)
      if (logId !== requestId) continue
    } catch { continue }

    // topic-2 = indexed merchant (address padded to 32 bytes)
    const merchantTopic = log.topics[2]
    if (!merchantTopic) continue
    // address is last 20 bytes of 32-byte topic
    const logMerchant = '0x' + merchantTopic.slice(-40)
    if (logMerchant.toLowerCase() !== req.merchant.toLowerCase()) continue

    // topic-3 = indexed payer
    const payerTopic = log.topics[3]
    if (!payerTopic) continue
    const logPayer = '0x' + payerTopic.slice(-40)
    if (logPayer.toLowerCase() !== payerAddress.toLowerCase()) continue

    // data[0] = amount (first 32 bytes of data)
    if (!log.data || log.data.length < 66) continue
    try {
      const logAmount = BigInt('0x' + log.data.slice(2, 66))
      if (logAmount !== req.amount) continue
    } catch { continue }

    // All checks passed — this is a valid PaymentRecorded for this request
    return true
  }
  return false
}

const USDC_ADDRESS = getUsdc(ARC_TESTNET_ID).address

// ── Live countdown ────────────────────────────────────────────────────────────
// Returns a formatted countdown string ("4m 32s", "59s", "Expired") that
// updates every second. expiresAt is a Unix timestamp in seconds (bigint).
// isPaid/isCancelled suppress urgency — the request is already settled so
// there is no time pressure to show to the customer.
function useCountdown(
  expiresAt: bigint | undefined,
  settled: boolean
): { label: string; urgent: boolean } {
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000)
    return () => clearInterval(id)
  }, [])

  if (expiresAt === undefined) return { label: '—', urgent: false }
  // Settled requests (paid/cancelled): show static expiry label only, no urgency
  if (settled) {
    const secs = Number(expiresAt) - now
    if (secs <= 0) return { label: 'Expired', urgent: false }
    if (secs < 3600) {
      const m = Math.floor(secs / 60); const s = secs % 60
      return { label: `${m}m ${s}s`, urgent: false }
    }
    const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60)
    return { label: `${h}h ${m}m`, urgent: false }
  }
  // Open request: show live countdown with urgency colouring
  const secs = Number(expiresAt) - now
  if (secs <= 0) return { label: 'Expired', urgent: true }
  if (secs < 60) return { label: `${secs}s`, urgent: true }
  if (secs < 3600) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return { label: `${m}m ${s}s`, urgent: secs < 120 }
  }
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return { label: `${h}h ${m}m`, urgent: false }
}

// ── Phase type ────────────────────────────────────────────────────────────────

type Phase = 'preview' | 'approving' | 'paying' | 'done' | 'unresolved'

// ── Pending-hash persistence ──────────────────────────────────────────────────
// Keyed by chainId + contract + account (lowercase) + requestId so different
// accounts / requests never mix, and account/network switches clear the state.

interface PersistedPayState {
  approveHash?: `0x${string}`
  payHash?: `0x${string}`
  phase: Phase
}

function pendingPayKey(account: string, requestId: bigint): string {
  return `arc-receipt:checkout:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${account.toLowerCase()}:${requestId.toString()}`
}

function savePendingPay(account: string, requestId: bigint, state: PersistedPayState): void {
  try {
    sessionStorage.setItem(pendingPayKey(account, requestId), JSON.stringify(state))
  } catch { /* ignore */ }
}

function loadPendingPay(account: string, requestId: bigint): PersistedPayState | null {
  try {
    const raw = sessionStorage.getItem(pendingPayKey(account, requestId))
    if (!raw) return null
    return JSON.parse(raw) as PersistedPayState
  } catch { return null }
}

function clearPendingPay(account: string, requestId: bigint): void {
  try {
    sessionStorage.removeItem(pendingPayKey(account, requestId))
  } catch { /* ignore */ }
}

// ── Error decoder ─────────────────────────────────────────────────────────────

function decodeError(msg: string): string {
  if (/user rejected|User rejected|4001/i.test(msg))
    return 'You rejected the request in your wallet.'
  if (/insufficient funds|InsufficientFunds/i.test(msg))
    return 'Insufficient USDC balance or gas.'
  if (/SelfPayment/i.test(msg))
    return 'You are the merchant — you cannot pay your own request.'
  if (/RequestNotOpen|RequestNotFound/i.test(msg))
    return 'This request is no longer available.'
  if (/RequestExpired/i.test(msg))
    return 'This request has expired.'
  if (/allowance|SafeERC20/i.test(msg))
    return 'USDC allowance insufficient. Please approve first.'
  if (/network changed|underlying network/i.test(msg))
    return 'Network changed mid-flow. Please switch back to Arc Testnet.'
  if (/timeout|fetch|RPC/i.test(msg))
    return 'Network error — check your connection and try again.'
  const clean = msg.replace(/^[\w.]+Error:\s*/i, '').slice(0, 140)
  return clean
}

// ── Main component ────────────────────────────────────────────────────────────

interface PublicCheckoutProps {
  requestId: bigint
  onPaid?: (txHash: `0x${string}`) => void
}

export function PublicCheckout({ requestId, onPaid }: PublicCheckoutProps) {
  const { address, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const {
    data: rawReq, isLoading: loadingReq, error: reqError, refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
    functionName: 'getRequest', args: [requestId],
    chainId: ARC_TESTNET_ID,
    query: { refetchInterval: 5_000 },
  })
  const req = rawReq as OnchainRequest | undefined

  // B: Check current USDC allowance — used to skip approval when already granted
  const { data: currentAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0000000000000000000000000000000000000000', CONTRACT_ADDRESS],
    chainId: ARC_TESTNET_ID,
    query: {
      enabled: !!address && !!req && req.status === 0,
      refetchInterval: 10_000,
    },
  })

  const { writeContract, isPending: isWalletPending, reset: resetWrite } = useWriteContract()

  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [payHash, setPayHash]         = useState<`0x${string}` | undefined>()
  const [phase, setPhase]             = useState<Phase>('preview')
  const [errMsg, setErrMsg]           = useState<string | null>(null)
  const restoredRef = useRef(false)

  // B: Restore pending pay state after refresh
  useEffect(() => {
    if (!address || !req || restoredRef.current) return
    restoredRef.current = true
    const saved = loadPendingPay(address, requestId)
    if (!saved) return
    // Only restore if the request is still open (don't restore onto a paid request)
    if (req.status !== 0) {
      clearPendingPay(address, requestId)
      return
    }
    if (saved.approveHash) setApproveHash(saved.approveHash)
    if (saved.payHash) setPayHash(saved.payHash)
    if (saved.phase !== 'preview') setPhase(saved.phase)
  }, [address, req, requestId])

  // B: Persist pay state whenever it changes
  const prevPersistKey = useRef<string | null>(null)
  useEffect(() => {
    if (!address) return
    const stateKey = pendingPayKey(address, requestId)
    // Only persist when there's something worth persisting
    if (!approveHash && !payHash && phase === 'preview') {
      // Clear stale entry on reset
      if (prevPersistKey.current === stateKey) {
        clearPendingPay(address, requestId)
      }
      return
    }
    prevPersistKey.current = stateKey
    savePendingPay(address, requestId, { approveHash, payHash, phase })
  }, [address, requestId, approveHash, payHash, phase])

  // Wait for approve confirmation
  const {
    isLoading: isApproveConfirming, isSuccess: approveConfirmed,
    isError: isApproveError, error: approveReceiptError,
  } = useWaitForTransactionReceipt({
    hash: approveHash,
    chainId: ARC_TESTNET_ID,
    pollingInterval: 1_000,
    confirmations: 1,
  })

  // Wait for pay confirmation
  const {
    isLoading: isPayConfirming, isSuccess: payConfirmed, data: payReceipt,
    isError: isPayError, error: payReceiptError,
  } = useWaitForTransactionReceipt({
    hash: payHash,
    chainId: ARC_TESTNET_ID,
    pollingInterval: 1_000,
    confirmations: 1,
  })

  // B: After restore + allowance read, skip approval phase if already approved
  const allowanceSufficient =
    !!req && currentAllowance !== undefined && (currentAllowance) >= req.amount

  useEffect(() => {
    if (phase !== 'approving' || approveConfirmed) return
    // If we restored to 'approving' and allowance is already sufficient, advance
    if (allowanceSufficient && !approveHash) {
      setPhase('paying')
    }
  }, [phase, allowanceSufficient, approveHash, approveConfirmed])

  // Advance from approving→paying once approval is confirmed
  const didAdvance = useRef(false)
  useEffect(() => {
    if (!approveConfirmed || phase !== 'approving' || didAdvance.current) return
    didAdvance.current = true
    setPhase('paying')
    resetWrite()
  }, [approveConfirmed, phase, resetWrite])

  // Report paid exactly once — only after validating the PaymentRecorded event.
  //
  // Stage 1 correctness rule: wagmi's useWaitForTransactionReceipt confirms that
  // a TX was mined successfully, but it does NOT verify that the TX executed the
  // intended contract function. A replacement TX that was repriced or redirected
  // could succeed without emitting PaymentRecorded for this (id, merchant, payer,
  // amount). We validate every log in the receipt before calling onPaid().
  //
  // If the receipt is confirmed but no matching PaymentRecorded is found, we set
  // phase='unresolved' and show an explorer link so the customer can investigate.
  // We do NOT claim payment success in that case.
  //
  // The wallet address at submission time is captured in the payHash effect
  // dependency — if the wallet changes, reportedHash guard prevents double-fire,
  // and the address used for clearPendingPay is taken from the closure.
  const reportedHash = useRef<string | null>(null)
  useEffect(() => {
    if (!payConfirmed || !payHash || !payReceipt || reportedHash.current === payHash) return
    // Always refetch authoritative contract state regardless of validation result
    void refetch()
    // Validate that the confirmed receipt contains the expected PaymentRecorded event
    const isValid = req !== undefined && address !== undefined
      ? validatePaymentReceipt(payReceipt, requestId, req, address)
      : false

    if (!isValid) {
      // Confirmed TX but no matching PaymentRecorded — unresolved outcome.
      // This can happen with replacement TXs or relay failures. Do NOT advance
      // to done/success state. Show the explorer link so customer can investigate.
      // Do NOT clear sessionStorage — the pending state remains for retry.
      setPhase('unresolved')
      setErrMsg(
        'Payment TX confirmed but the expected payment event was not found. ' +
        'Check the explorer link for details. If in doubt, do not pay again — wait ' +
        'for the merchant to verify the request status.'
      )
      toast.error('Payment outcome unclear — check explorer before retrying.')
      return
    }

    // Valid PaymentRecorded confirmed — advance to done
    reportedHash.current = payHash
    setPhase('done')
    if (address) clearPendingPay(address, requestId)
    onPaid?.(payHash)
  }, [payConfirmed, payHash, payReceipt, onPaid, refetch, address, requestId, req])

  // ── Approve TX reverted ──────────────────────────────────────────────────
  // wagmi fires isError when the TX is mined but execution failed (reverted).
  // Reset to preview so the customer can retry approval.
  useEffect(() => {
    if (!isApproveError || !approveReceiptError) return
    const msg = decodeError(approveReceiptError.message)
    setErrMsg(`Approval failed: ${msg}`)
    toast.error(`Approval transaction failed: ${msg}`)
    setApproveHash(undefined)
    setPhase('preview')
    resetWrite()
  }, [isApproveError, approveReceiptError, resetWrite])

  // ── Pay TX reverted ───────────────────────────────────────────────────────
  // A reverted pay TX leaves the request still open — the customer can retry
  // without the merchant creating a new order. Clear payHash and stay on
  // the paying phase so the Pay button becomes active again.
  useEffect(() => {
    if (!isPayError || !payReceiptError) return
    const msg = decodeError(payReceiptError.message)
    setErrMsg(`Payment failed: ${msg} — you can retry below.`)
    toast.error(`Payment transaction failed: ${msg}`)
    // Clear the failed hash so the Pay button re-enables
    setPayHash(undefined)
    resetWrite()
    // Stay on 'paying' phase — request is still open, customer can retry
    setPhase('paying')
    // Refetch contract state to confirm the request is still open
    void refetch()
  }, [isPayError, payReceiptError, resetWrite, refetch])

  // ── Expiry notification ───────────────────────────────────────────────────
  // Track the last-seen open state so we can detect the open→expired transition
  // that happens during a 5-second refetch cycle while the user is on the page.
  const wasOpenRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!req) return
    const nowExpired = isExpired(req)
    const nowOpen = req.status === 0 && !nowExpired

    if (wasOpenRef.current === true && !nowOpen && req.status === 0) {
      // Transition: was open → now expired (status still 0, only expiry changed).
      // Fire exactly once per request.
      toast.error('This payment request has expired. Ask the merchant for a new link.')
      if (phase === 'approving' || phase === 'paying') {
        // Customer is mid-flow — warn that any in-flight TX will revert
        toast.warning(
          'Your transaction may have been submitted but the request is now expired. ' +
          'If it confirms, the contract will reject it. Check the explorer before trying again.'
        )
      }
    }

    wasOpenRef.current = nowOpen
  }, [req, phase])

  // Reset when requestId changes — clear ALL per-request refs so route
  // A→B cannot carry A's success guard, stale hashes or restore state into B.
  useEffect(() => {
    didAdvance.current = false
    restoredRef.current = false
    reportedHash.current = null  // Stage 1: reset so new requestId starts clean
    wasOpenRef.current = null     // reset expiry tracker for new request
    setPhase('preview')
    setApproveHash(undefined)
    setPayHash(undefined)
    setErrMsg(null)
    resetWrite()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  const busy = isWalletPending || isApproveConfirming || isPayConfirming || isSwitching

  const handleApprove = useCallback(() => {
    if (!req) return
    if (!address) { toast.error('Connect your wallet first'); return }
    if (busy) return
    if (chainId !== ARC_TESTNET_ID) { switchChain({ chainId: ARC_TESTNET_ID }); return }

    // B: skip approval if allowance already sufficient
    if (allowanceSufficient) {
      setPhase('paying')
      return
    }

    setErrMsg(null)
    setPhase('approving')
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CONTRACT_ADDRESS, req.amount],
      chainId: ARC_TESTNET_ID,
    }, {
      onSuccess: (hash) => {
        setApproveHash(hash)
        toast.success('Approval submitted — waiting for confirmation…')
      },
      onError: (e) => {
        setErrMsg(decodeError(e.message))
        setPhase('preview')
        resetWrite()
      },
    })
  }, [req, address, chainId, busy, allowanceSufficient, switchChain, writeContract, resetWrite])

  const handlePay = useCallback(() => {
    if (!req) return
    if (!address) { toast.error('Connect your wallet first'); return }
    if (busy) return
    if (payHash) {
      toast.info('Payment already submitted — please wait for confirmation.')
      return
    }
    if (chainId !== ARC_TESTNET_ID) { switchChain({ chainId: ARC_TESTNET_ID }); return }
    setErrMsg(null)
    writeContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'pay', args: [requestId],
      chainId: ARC_TESTNET_ID,
    }, {
      onSuccess: (hash) => {
        setPayHash(hash)
        toast.success('Payment submitted — waiting for confirmation…')
      },
      onError: (e) => {
        setErrMsg(decodeError(e.message))
        resetWrite()
      },
    })
  }, [req, address, chainId, busy, payHash, switchChain, writeContract, requestId, resetWrite])

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loadingReq) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Payment request #{requestId.toString()}
          </p>
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <span className="text-sm">Loading verified details from Arc Testnet…</span>
          </div>
          <div className="h-4 rounded bg-slate-100 animate-pulse w-2/3" />
          <div className="h-4 rounded bg-slate-100 animate-pulse w-1/2" />
        </div>
        <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    )
  }

  if (reqError) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-700">
              Could not load request #{requestId.toString()}
            </p>
            <p className="text-xs text-rose-600 mt-0.5">
              Unable to reach Arc Testnet. Check your connection and try again.
              If you use a browser with strict content blocking (e.g. Brave Shields),
              it may be blocking the RPC providers — try allowing this site or disabling shields temporarily.
            </p>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          className="w-full py-2.5 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-sm font-semibold transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!req || req.merchant === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 text-center space-y-1">
        <p className="text-sm font-semibold text-slate-600">Request #{requestId.toString()} not found</p>
        <p className="text-xs text-slate-400">This ID does not exist on Arc Testnet.</p>
      </div>
    )
  }

  const expired = isExpired(req)
  const isOpen = req.status === 0 && !expired
  const isPaid = req.status === 1
  const isCancelled = req.status === 2
  const isMerchant = !!address && address.toLowerCase() === req.merchant.toLowerCase()
  const isWrongChain = !!address && chainId !== ARC_TESTNET_ID

  // ── Done state ────────────────────────────────────────────────────────────

  if (phase === 'done' && payHash) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-3">
          <CheckCircle size={32} className="text-emerald-500 mx-auto" />
          <div>
            <p className="text-base font-bold text-emerald-800">Payment confirmed</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              {formatUsdc(req.amount)} USDC transferred to merchant
            </p>
          </div>
          <a
            href={buildTxExplorerUrl(ARC_TESTNET_ID, payHash)}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline"
          >
            <ExternalLink size={14} /> View PaymentRecorded event
          </a>
        </div>
        <div className="rounded-xl bg-white border border-[#CBD5E1] p-3 text-xs text-slate-600 space-y-1.5">
          <Row label="Request" value={`#${requestId.toString()}`} mono />
          <Row label="Merchant" value={formatAddr(req.merchant)} mono />
          <Row label="Payer" value={address ? formatAddr(address) : '—'} mono />
          <Row label="Amount" value={`${formatUsdc(req.amount)} USDC`} />
          <Row label="TX" value={payHash.slice(0, 20) + '…'} mono />
        </div>
      </div>
    )
  }

  // ── Unresolved outcome (TX confirmed but PaymentRecorded not found) ──────
  // This is shown when a replacement or unexpected TX was confirmed without
  // the expected PaymentRecorded event. We do NOT declare success.
  // The authoritative request state (req.status) is shown so the customer
  // can see whether the contract recorded a payment.
  if (phase === 'unresolved' && payHash) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={20} className="text-amber-500" />
            <p className="text-sm font-semibold text-amber-800">Payment outcome unclear</p>
          </div>
          <p className="text-xs text-amber-700">
            A transaction was confirmed, but the expected payment event was not found
            in the receipt. The contract status is shown below.
            Do not pay again without checking the explorer first.
          </p>
          <div className="rounded-xl bg-white border border-amber-100 p-3 text-xs text-slate-500 space-y-1">
            <Row label="Request" value={`#${requestId.toString()}`} mono />
            <Row label="Contract status" value={isPaid ? 'Paid' : isOpen ? 'Open' : isCancelled ? 'Cancelled' : 'Expired'} />
            {isPaid && <Row label="Payer" value={formatAddr(req.payer)} mono />}
          </div>
          <a
            href={buildTxExplorerUrl(ARC_TESTNET_ID, payHash)}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:underline"
          >
            <ExternalLink size={14} /> Check TX on explorer
          </a>
          {isPaid && (
            <p className="text-xs text-emerald-700 font-medium">
              The contract now shows this request as Paid — no further action needed.
            </p>
          )}
        </div>
        <button
          onClick={() => void refetch()}
          className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
        >
          <RefreshCw size={14} /> Check again
        </button>
      </div>
    )
  }

  // ── Already paid ─────────────────────────────────────────────────────────

  if (isPaid) {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle size={20} className="text-emerald-500" />
          <p className="text-sm font-semibold text-emerald-800">Already paid</p>
        </div>
        <RequestPreviewRows req={req} requestId={requestId} />
        <p className="text-xs text-emerald-700">
          Paid by <span className="font-mono">{formatAddr(req.payer)}</span> at {formatTs(req.paidAt)}.
        </p>
      </div>
    )
  }

  // ── Not payable ───────────────────────────────────────────────────────────

  if (isCancelled || expired) {
    return (
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-slate-400" />
          <p className="text-sm font-semibold text-slate-600">
            {isCancelled ? 'Request cancelled' : 'Request expired'}
          </p>
        </div>
        <RequestPreviewRows req={req} requestId={requestId} />
        <p className="text-xs text-slate-500 pt-1 border-t border-slate-200">
          {isCancelled
            ? 'This request was cancelled by the merchant. No payment has been taken. Ask the merchant for a new link if needed.'
            : 'This request expired before payment was made. No funds have been taken. Ask the merchant to create a new payment request.'}
        </p>
      </div>
    )
  }

  // ── Open — show checkout flow ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-[#CBD5E1] p-4 space-y-3 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          Payment request #{requestId.toString()}
        </p>
        <div className="flex items-end gap-1.5">
          <TokenUSDC variant="branded" size={28} />
          <span
            className="text-4xl font-bold tabular-nums tracking-tight text-slate-900"
            style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.03em' }}
          >
            {formatUsdc(req.amount)}
          </span>
          <span className="text-base text-slate-400 mb-0.5">USDC</span>
        </div>
        <RequestPreviewRows req={req} requestId={requestId} />
      </div>

      <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-[#CBD5E1] rounded-xl p-3">
        <ShieldCheck size={14} className="shrink-0 mt-0.5 text-emerald-500" />
        <span className="text-pretty">
          Amount and recipient are read directly from the contract — not from the URL.
          Your approval is granted only to{' '}
          <span className="font-mono">{formatAddr(CONTRACT_ADDRESS)}</span> for the exact
          amount shown.
        </span>
      </div>

      {isMerchant && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-xs text-amber-700">
          <AlertCircle size={14} /> You created this request — connect a different wallet to pay.
        </div>
      )}

      {errMsg && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errMsg}</span>
        </div>
      )}

      {!address ? (
        <div className="flex justify-center pt-1">
          <ConnectKitButton />
        </div>
      ) : isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_ID })}
          disabled={isSwitching}
          className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2"
        >
          {isSwitching
            ? <><Loader2 size={14} className="animate-spin" /> Switching…</>
            : <><AlertCircle size={15} /> Switch to Arc Testnet</>}
        </button>
      ) : phase === 'preview' || phase === 'approving' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              {allowanceSufficient && !approveHash
                ? 'Allowance already granted — proceed to pay'
                : 'Step 1 of 2 — Approve exact USDC amount'}
            </span>
            {approveHash && phase === 'approving' && !approveConfirmed && (
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_ID, approveHash)}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-0.5 hover:text-slate-600"
              >
                <ExternalLink size={11} /> Pending
              </a>
            )}
          </div>
          <button
            onClick={handleApprove}
            disabled={busy || !isOpen || isMerchant || !!approveHash}
            className="w-full py-3.5 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isWalletPending && phase === 'approving'
              ? <><Loader2 size={14} className="animate-spin" /> Confirm in wallet…</>
              : isApproveConfirming
              ? <><Loader2 size={14} className="animate-spin" /> Approval confirming…</>
              : approveHash
              ? <><Loader2 size={14} className="animate-spin" /> Waiting for confirmation…</>
              : allowanceSufficient
              ? <><ArrowRight size={14} /> Skip approval — proceed to pay</>
              : <><ArrowRight size={14} /> Approve {formatUsdc(req.amount)} USDC</>}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Step 2 of 2 — Send {formatUsdc(req.amount)} USDC</span>
            {payHash && phase === 'paying' && !payConfirmed && (
              <a
                href={buildTxExplorerUrl(ARC_TESTNET_ID, payHash)}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-0.5 hover:text-slate-600"
              >
                <ExternalLink size={11} /> Pending
              </a>
            )}
          </div>
          <button
            onClick={handlePay}
            disabled={busy || !isOpen || isMerchant || phase === 'done'}
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isWalletPending && phase === 'paying'
              ? <><Loader2 size={14} className="animate-spin" /> Confirm in wallet…</>
              : isPayConfirming
              ? <><Loader2 size={14} className="animate-spin" /> Payment confirming…</>
              : payHash
              ? <><Loader2 size={14} className="animate-spin" /> Waiting for confirmation…</>
              : <><CheckCircle size={14} /> Pay {formatUsdc(req.amount)} USDC</>}
          </button>
          {(approveHash || allowanceSufficient) && (
            <p className="text-xs text-center text-emerald-600">
              ✓ USDC approved — ready to pay
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function RequestPreviewRows({ req, requestId }: { req: OnchainRequest; requestId: bigint }) {
  const [copiedAddr, setCopiedAddr] = React.useState(false)
  // settled = paid or cancelled — no urgency styling needed
  const settled = req.status === 1 || req.status === 2
  const { label: countdown, urgent } = useCountdown(req.expiresAt, settled)
  const copyAddr = () => {
    void navigator.clipboard.writeText(req.merchant).then(() => {
      setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 2000)
    })
  }

  return (
    <div className="text-xs text-slate-600 space-y-1.5">
      <Row label="Request" value={`#${requestId.toString()}`} mono />
      {/* Merchant address — full address, copyable */}
      <div className="flex justify-between gap-2 items-start">
        <span className="text-slate-500 shrink-0">Merchant</span>
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-slate-600 break-all text-right">{req.merchant}</span>
          <button
            onClick={copyAddr}
            className="shrink-0 p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            title="Copy merchant address"
            aria-label="Copy merchant address"
          >
            {copiedAddr
              ? <CheckCircle size={11} className="text-emerald-500" />
              : <Copy size={11} />}
          </button>
        </div>
      </div>
      {/* Live countdown — turns red/amber when under 2 minutes */}
      <div className="flex justify-between gap-2">
        <span className="text-slate-500 shrink-0 flex items-center gap-0.5">
          <Clock size={11} /> Expires
        </span>
        <span className={urgent ? 'font-semibold text-rose-600' : ''}>
          {formatTs(req.expiresAt)}{' '}
          <span className={`tabular-nums ${urgent ? 'text-rose-600' : 'text-slate-400'}`}>
            ({countdown})
          </span>
        </span>
      </div>
      <Row label="Network" value="Arc Testnet (5042002)" />
    </div>
  )
}

function Row({ label, value, mono }: { label: React.ReactNode; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`truncate text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
