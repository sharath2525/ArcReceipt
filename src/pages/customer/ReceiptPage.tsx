/**
 * /receipt/:requestId — Public payment receipt.
 * Wallet-free. Reads all state from chain.
 * Accepts payTxHash from router state (passed after successful payment)
 * to link directly to the payment TX without a second chain query.
 */
import { useParams, useLocation } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PublicReceipt } from '@/components/PublicReceipt'

interface LocationState {
  payTxHash?: `0x${string}`
}

export default function ReceiptPage() {
  const { requestId: rawId } = useParams<{ requestId: string }>()
  const location = useLocation()
  const state = location.state as LocationState | null

  let requestId: bigint | null = null
  try {
    if (rawId) {
      const n = BigInt(rawId)
      if (n > 0n) requestId = n
    }
  } catch { /* invalid */ }

  if (requestId === null) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-center space-y-2 mt-4">
        <AlertCircle size={24} className="mx-auto text-rose-400" />
        <p className="text-sm font-semibold text-rose-700">Invalid receipt link</p>
        <p className="text-xs text-rose-500">The request ID in this URL is not valid.</p>
      </div>
    )
  }

  return (
    <div className="mt-2">
      <PublicReceipt requestId={requestId} payTxHash={state?.payTxHash} />
    </div>
  )
}
