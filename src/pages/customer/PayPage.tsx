/**
 * /pay/:requestId — Customer checkout page.
 * Wraps PublicCheckout. After payment, navigates to /receipt/:id.
 */
import { useParams, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { PublicCheckout } from '@/components/PublicCheckout'

export default function PayPage() {
  const { requestId: rawId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()

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
        <p className="text-sm font-semibold text-rose-700">Invalid payment link</p>
        <p className="text-xs text-rose-500">The request ID in this URL is not valid.</p>
      </div>
    )
  }

  return (
    <div className="mt-2">
      <PublicCheckout
        requestId={requestId}
        onPaid={(txHash) => {
          void navigate(`/receipt/${requestId.toString()}`, { state: { payTxHash: txHash } })
        }}
      />
    </div>
  )
}
