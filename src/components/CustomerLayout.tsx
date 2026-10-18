/**
 * CustomerLayout — narrow mobile-first payment shell.
 *
 * Used for all customer-facing routes: /pay/:id, /receipt/:id,
 * /payments, /verify.
 *
 * Rules:
 * - No merchant navigation, no Sell/Orders/Reports/Settings/Demo.
 * - Logo navigates to /verify (safe public landing, never the merchant workspace).
 * - Connecting a wallet never changes merchant identity.
 * - The layout is entirely independent of who is connected.
 * - Nav shows Verify and My Payments only — never merchant routes.
 * - Payment/receipt routes (/pay/:id, /receipt/:id) are not nav items;
 *   they are reached via QR links only. The nav does not highlight them.
 */
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { Receipt, Search, FileText } from 'lucide-react'

const CUSTOMER_NAV = [
  { to: '/verify',   label: 'Verify',      icon: <Search   size={14} /> },
  { to: '/payments', label: 'My Payments', icon: <FileText size={14} /> },
]

export function CustomerLayout() {
  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 flex flex-col">
      {/* Testnet banner */}
      <div className="w-full bg-amber-400 text-amber-900 text-center text-xs font-semibold py-1.5 px-4 tracking-wide">
        TESTNET — Arc Testnet (chain 5042002) — No real funds
      </div>

      {/* Header */}
      <header className="px-4 pt-4 pb-3 flex items-center justify-between max-w-lg mx-auto w-full">
        {/* Logo links to /verify — customer-safe landing, not merchant workspace */}
        <Link to="/verify" className="flex items-center gap-2">
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

      {/* Customer nav — Verify + My Payments only.
          /pay/:id and /receipt/:id are not nav items (reached by QR link). */}
      <div className="max-w-lg mx-auto w-full px-4 pb-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {CUSTOMER_NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
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
