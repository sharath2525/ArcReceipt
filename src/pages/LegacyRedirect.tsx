/**
 * LegacyRedirect — handles the old query-string URL scheme.
 *
 * Old URLs that must keep working:
 *   ?request=N                → /pay/N       (customer checkout)
 *   ?request=N&view=receipt   → /receipt/N   (public receipt)
 *   ?request=N&view=order     → /merchant/orders/N  (merchant order QR)
 *   ?view=orders              → /merchant/orders
 *   ?view=my-receipts         → /payments
 *   ?view=verify              → /verify
 *   ?view=demo                → /merchant/demo
 *   /  (no params)            → /verify      (neutral landing for shared links)
 *
 * This component is rendered for the root "/" route. It runs on mount,
 * inspects the query string, and immediately redirects via React Router.
 * Browser back/forward works because we use Navigate (replaces history entry).
 */
import { Navigate, useSearchParams } from 'react-router-dom'

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

  // ?view=sell  or  bare /  → /verify (safe public landing)
  return <Navigate to="/verify" replace />
}
