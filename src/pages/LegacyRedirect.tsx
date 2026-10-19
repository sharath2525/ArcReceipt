/**
 * LegacyRedirect — handles the old query-string URL scheme at "/".
 *
 * Old URLs that must keep working:
 *   ?request=N                → /pay/N       (customer checkout)
 *   ?request=N&view=receipt   → /receipt/N   (public receipt)
 *   ?request=N&view=order     → /merchant/orders/N  (merchant order QR)
 *   ?view=orders              → /merchant/orders
 *   ?view=my-receipts         → /payments
 *   ?view=verify              → /verify
 *   ?view=demo                → /merchant/demo
 *   /  (no params)            → renders HomePage directly (no redirect)
 *
 * When there are no query params, this component renders the HomePage
 * directly rather than redirecting, to avoid an infinite loop on the same
 * path.
 */
import { Navigate, useSearchParams } from 'react-router-dom'
import HomePage from './HomePage'

export default function LegacyRedirect() {
  const [params] = useSearchParams()
  const view = params.get('view')
  const requestParam = params.get('request')

  let requestId: bigint | null = null
  if (requestParam) {
    try {
      const n = BigInt(requestParam)
      if (n > 0n) requestId = n
    } catch { /* invalid — treat as no request */ }
  }

  // ?request=N&view=receipt  → /receipt/N
  if (requestId !== null && view === 'receipt') {
    return <Navigate to={`/receipt/${requestId.toString()}`} replace />
  }

  // ?request=N&view=order  → /merchant/orders/N
  if (requestId !== null && view === 'order') {
    return <Navigate to={`/merchant/orders/${requestId.toString()}`} replace />
  }

  // ?request=N (plain checkout link — the common case for shared QR links)
  if (requestId !== null) {
    return <Navigate to={`/pay/${requestId.toString()}`} replace />
  }

  // ?view=orders
  if (view === 'orders') {
    return <Navigate to="/merchant/orders" replace />
  }

  // ?view=my-receipts
  if (view === 'my-receipts') {
    return <Navigate to="/payments" replace />
  }

  // ?view=verify
  if (view === 'verify') {
    return <Navigate to="/verify" replace />
  }

  // ?view=demo
  if (view === 'demo') {
    return <Navigate to="/merchant/demo" replace />
  }

  // bare "/" with no recognised params → Home page (rendered directly, no redirect)
  return <HomePage />
}
