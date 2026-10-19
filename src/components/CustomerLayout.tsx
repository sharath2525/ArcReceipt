/**
 * CustomerLayout — narrow mobile-first payment shell.
 *
 * Part 2 changes (D / E):
 *   - Logo and header link to "/" (home) instead of /verify.
 *   - Nav includes Home, Verify, My Payments.
 *   - /pay/:id and /receipt/:id still excluded from nav (QR-only entry) but
 *     layout renders an unobtrusive "Back to payment #N" contextual link when
 *     a persisted checkout session exists for the connected wallet — so the
 *     customer can return without losing their pending tx.
 *   - Connecting a wallet never exposes merchant navigation.
 *   - Merchant address/identity never changes from wallet connection here.
 *
 * Rules preserved:
 * - No merchant navigation, no Sell/Orders/Reports/Settings/Demo.
 * - Customer connections never become merchant sessions.
 * - The layout is entirely independent of who is connected.
 */
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Receipt, Search, FileText, Home } from 'lucide-react'
import { useAccount } from 'wagmi'
import { ARC_TESTNET_ID } from '@/lib/contract'
import { CONTRACT_ADDRESS } from '@/lib/contract'

const CUSTOMER_NAV = [
  { to: '/',        label: 'Home',       icon: <Home     size={14} />, end: true },
  { to: '/verify',  label: 'Verify',     icon: <Search   size={14} /> },
  { to: '/payments',label: 'My Payments',icon: <FileText size={14} /> },
]

// ── Pending checkout hint ─────────────────────────────────────────────────────
// When the user is NOT on /pay/:id and there's an active pending checkout
// session for them, show a small contextual link back to it.

function useActivePay(): { requestId: string | null } {
  const { address } = useAccount()
  const location = useLocation()

  // Only show when we're NOT already on a /pay/ route
  if (!address || location.pathname.startsWith('/pay/')) return { requestId: null }
  if (!address) return { requestId: null }

  // Scan sessionStorage for a persisted checkout session
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (!key) continue
      // Key pattern: arc-receipt:checkout:{chainId}:{contract}:{account}:{requestId}
      const prefix = `arc-receipt:checkout:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS.toLowerCase()}:${address.toLowerCase()}:`
      if (!key.startsWith(prefix)) continue
      const requestId = key.slice(prefix.length)
      if (!requestId || !/^\d+$/.test(requestId)) continue
      // Check the persisted phase — only hint if we have something actionable
      const raw = sessionStorage.getItem(key)
      if (!raw) continue
      try {
        const s = JSON.parse(raw) as { phase?: string }
        if (s.phase && s.phase !== 'done') {
          return { requestId }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return { requestId: null }
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function CustomerLayout() {
  const location = useLocation()
  const params = useParams<{ requestId?: string }>()
  const { requestId: activePayId } = useActivePay()

  // Hide the nav bar on /pay/:id and /receipt/:id — those are QR-only pages
  const isPayOrReceipt =
    location.pathname.startsWith('/pay/') ||
    location.pathname.startsWith('/receipt/')

  // Show "Back to payment" hint when the user navigated away from an active checkout
  const showBackHint =
    activePayId !== null &&
    !isPayOrReceipt &&
    params.requestId !== activePayId

  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 flex flex-col">
      {/* Testnet banner */}
      <div className="w-full bg-amber-400 text-amber-900 text-center text-xs font-semibold py-1.5 px-4 tracking-wide">
        TESTNET — Arc Testnet (chain {ARC_TESTNET_ID}) — No real funds
      </div>

      {/* Header — logo links to "/" (home) */}
      <header className="px-4 pt-4 pb-3 flex items-center justify-between max-w-lg mx-auto w-full">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <Receipt size={15} className="text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              ArcReceipt
            </p>
            <p className="text-xs text-slate-400 leading-tight">Checkout on Arc Testnet</p>
          </div>
        </Link>
        <ConnectKitButton />
      </header>

      {/* Nav — Home + Verify + My Payments. Hidden on /pay/ and /receipt/ */}
      {!isPayOrReceipt && (
        <div className="max-w-lg mx-auto w-full px-4 pb-3">
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {CUSTOMER_NAV.map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`
                }
              >
                {icon}
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* "Back to payment #N" contextual hint */}
      {showBackHint && activePayId && (
        <div className="max-w-lg mx-auto w-full px-4 pb-2">
          <Link
            to={`/pay/${activePayId}`}
            className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <span>Payment #{activePayId} is still pending</span>
            <span className="font-semibold shrink-0">Back to payment →</span>
          </Link>
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pb-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto w-full px-4 pb-4 text-center">
        <p className="text-xs text-slate-300">Built with Arc Studio · Arc Testnet · Not audited</p>
      </footer>
    </div>
  )
}
