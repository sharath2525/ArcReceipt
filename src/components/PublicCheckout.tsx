/**
 * PublicCheckout — Part 1 revision
 *
 * Part 1 additions (B):
 *   - Persists approveHash + payHash to sessionStorage keyed by
 *     chainId + contract + account + requestId. Restores on refresh so
 *     the customer does not lose their pending approval/payment after a
 *     hard reload.
 *   - Checks current USDC allowance on mount and when returning to the
 *     'approving' phase — if allowance >= req.amount, jumps to 'paying'
 *     phase without asking the user to approve again.
 *   - phase is also persisted (restore to 'paying' when approve hash
 *     is confirmed but the tab was refreshed before pay).
 *   - All other behaviour preserved from Day 3.
 *
 * Day 3 fixes (preserved):
 *   - Single useWriteContract hook prevents duplicate wallet requests.
 *   - walletBusy guard spans both phases.
 *   - approveHash preserved before pay step.
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
  CheckCircle, AlertCircle, Loader2, ExternalLink, Clock, ArrowRight, ShieldCheck, Copy,
} from 'lucide-react'
import { buildTxExplorerUrl, getUsdc } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID, type OnchainRequest,
} from '@/lib/contract'
import { formatAddr, formatTs, isExpired } from '@/lib/ui'

const USDC_ADDRESS = getUsdc(ARC_TESTNET_ID).address

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

// ── Phase type ────────────────────────────────────────────────────────────────

type Phase = 'preview' | 'approving' | 'paying' | 'done'

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
  const { isLoading: isApproveConfirming, isSuccess: approveConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveHash,
      chainId: ARC_TESTNET_ID,
      pollingInterval: 1_000,
      confirmations: 1,
    })

  // Wait for pay confirmation
  const {
    isLoading: isPayConfirming, isSuccess: payConfirmed, data: payReceipt,
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

  // Report paid exactly once
  const reportedHash = useRef<string | null>(null)
  useEffect(() => {
    if (!payConfirmed || !payHash || !payReceipt || reportedHash.current === payHash) return
    reportedHash.current = payHash
    setPhase('done')
    if (address) clearPendingPay(address, requestId)
    onPaid?.(payHash)
    void refetch()
  }, [payConfirmed, payHash, payReceipt, onPaid, refetch, address, requestId])

  // Reset when requestId changes
  useEffect(() => {
    didAdvance.current = false
    restoredRef.current = false
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
        <div className="rounded-xl bg-white border border-slate-100 p-3 text-xs text-slate-500 space-y-1">
          <Row label="Request" value={`#${requestId.toString()}`} mono />
          <Row label="Merchant" value={formatAddr(req.merchant)} mono />
          <Row label="Payer" value={address ? formatAddr(address) : '—'} mono />
          <Row label="Amount" value={`${formatUsdc(req.amount)} USDC`} />
          <Row label="TX" value={payHash.slice(0, 20) + '…'} mono />
        </div>
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
      </div>
    )
  }

  // ── Open — show checkout flow ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
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

      <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl p-3">
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
  const copyAddr = () => {
    void navigator.clipboard.writeText(req.merchant).then(() => {
      setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 2000)
    })
  }

  return (
    <div className="text-xs text-slate-500 space-y-1.5">
      <Row label="Request" value={`#${requestId.toString()}`} mono />
      {/* Merchant address — full address, copyable */}
      <div className="flex justify-between gap-2 items-start">
        <span className="text-slate-400 shrink-0">Merchant</span>
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
      <Row label={<span className="flex items-center gap-0.5"><Clock size={11} /> Expires</span>}
        value={formatTs(req.expiresAt)} />
      <Row label="Network" value="Arc Testnet (5042002)" />
    </div>
  )
}

function Row({ label, value, mono }: { label: React.ReactNode; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
