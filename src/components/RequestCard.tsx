import { useReadContract } from 'wagmi'
import { CheckCircle, Circle, XCircle, Clock, ExternalLink } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import {
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  ARC_TESTNET_ID,
  type OnchainRequest,
} from '@/lib/contract'
import { formatAddr, formatTs, statusMeta, isExpired } from '@/lib/ui'

interface RequestCardProps {
  id: bigint
  label?: string
  /** Show pay button link */
  payHref?: string
  /** Show receipt TX link */
  payTxHash?: `0x${string}`
}

function StatusIcon({ status, req }: { status: 0 | 1 | 2; req?: OnchainRequest }) {
  if (status === 1) return <CheckCircle size={14} className="text-emerald-500" />
  if (status === 2) return <XCircle size={14} className="text-rose-400" />
  if (req && isExpired(req)) return <Clock size={14} className="text-slate-400" />
  return <Circle size={14} className="text-amber-500" />
}

export function RequestCard({ id, label, payTxHash }: RequestCardProps) {
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getRequest',
    args: [id],
    chainId: ARC_TESTNET_ID,
    query: { refetchInterval: 4000 },
  })

  const req = data as OnchainRequest | undefined

  if (isLoading || !req) {
    return <div className="rounded-2xl border border-slate-100 bg-white/60 h-32 animate-pulse" />
  }

  const meta = statusMeta(req.status, req)
  const expired = isExpired(req)

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${meta.bg}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest uppercase text-slate-400 font-mono">
          {label ?? `#${id.toString()}`}
        </span>
        <span className={`flex items-center gap-1 text-xs font-semibold ${meta.color}`}>
          <StatusIcon status={req.status} req={req} />
          {meta.label}
        </span>
      </div>

      {/* Amount */}
      <div className="flex items-end gap-1.5">
        <TokenUSDC variant="branded" size={22} />
        <span
          className="text-3xl font-bold tabular-nums tracking-tight text-slate-900"
          style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em' }}
        >
          {formatUsdc(req.amount)}
        </span>
        <span className="text-sm text-slate-400 mb-0.5">USDC</span>
      </div>

      {/* Details */}
      <div className="text-xs text-slate-500 space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-400">Merchant</span>
          <a
            href={buildAddressExplorerUrl(ARC_TESTNET_ID, req.merchant)}
            target="_blank" rel="noopener noreferrer"
            className="font-mono hover:text-slate-700 flex items-center gap-0.5"
          >
            {formatAddr(req.merchant)} <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 flex items-center gap-0.5"><Clock size={11} /> Expires</span>
          <span className={expired && req.status === 0 ? 'text-rose-500 font-semibold' : ''}>
            {formatTs(req.expiresAt)}
          </span>
        </div>
        {req.status === 1 && (
          <>
            <div className="flex justify-between">
              <span className="text-slate-400">Payer</span>
              <a
                href={buildAddressExplorerUrl(ARC_TESTNET_ID, req.payer)}
                target="_blank" rel="noopener noreferrer"
                className="font-mono hover:text-slate-700 flex items-center gap-0.5"
              >
                {formatAddr(req.payer)} <ExternalLink size={10} />
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Paid at</span>
              <span>{formatTs(req.paidAt)}</span>
            </div>
          </>
        )}
      </div>

      {/* Payment TX link if provided */}
      {payTxHash && (
        <a
          href={buildTxExplorerUrl(ARC_TESTNET_ID, payTxHash)}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline font-semibold"
        >
          <ExternalLink size={11} /> View PaymentRecorded event
        </a>
      )}
    </div>
  )
}
