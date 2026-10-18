/**
 * MerchantLayout — wider tablet/laptop sidebar workspace.
 *
 * Renders the sidebar nav + content area for all /merchant/* routes.
 * The MerchantGate inside this layout blocks access for non-merchant wallets.
 * Sidebar collapses to a bottom tab bar on mobile.
 */
import { NavLink, Outlet } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import {
  Receipt, ShoppingBag, ClipboardList, BarChart2, Settings,
  FlaskConical, CalendarDays,
} from 'lucide-react'
import { MerchantGate } from './MerchantGate'

const NAV_ITEMS = [
  { to: '/merchant',          label: 'Sell',     icon: <ShoppingBag size={16} />,   end: true },
  { to: '/merchant/today',    label: 'Today',    icon: <CalendarDays size={16} />,  end: true },
  { to: '/merchant/orders',   label: 'Orders',   icon: <ClipboardList size={16} />, end: true },
  { to: '/merchant/reports',  label: 'Reports',  icon: <BarChart2 size={16} />,     end: true },
  { to: '/merchant/settings', label: 'Settings', icon: <Settings size={16} />,      end: true },
]

const DEMO_ITEM = { to: '/merchant/demo', label: 'Demo', icon: <FlaskConical size={16} /> }

function NavItem({ to, label, icon, end }: { to: string; label: string; icon: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
          isActive
            ? 'bg-emerald-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

export function MerchantLayout() {
  return (
    <MerchantGate>
      <div className="min-h-dvh bg-gradient-to-br from-slate-50 via-white to-emerald-50/20 flex flex-col">
        {/* Testnet banner */}
        <div className="w-full bg-amber-400 text-amber-900 text-center text-xs font-semibold py-1.5 px-4 tracking-wide shrink-0">
          TESTNET — Arc Testnet (chain 5042002) — No real funds
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar — hidden on mobile, visible md+ */}
          <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-slate-200 bg-white/70 backdrop-blur-sm px-3 py-4 gap-1">
            {/* Logo */}
            <div className="flex items-center gap-2 px-2 pb-4 mb-1 border-b border-slate-100">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm shrink-0">
                <Receipt size={15} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  ArcReceipt
                </p>
                <p className="text-xs text-slate-400 leading-tight">Merchant</p>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 space-y-0.5">
              {NAV_ITEMS.map(item => (
                <NavItem key={item.to} {...item} />
              ))}
            </nav>

            {/* Demo (bottom, separated) */}
            <div className="pt-2 border-t border-slate-100">
              <NavItem {...DEMO_ITEM} end />
            </div>

            {/* Wallet */}
            <div className="pt-3 border-t border-slate-100">
              <ConnectKitButton />
            </div>

            {/* Attribution */}
            <p className="text-xs text-slate-300 text-center pt-2">Built with Arc Studio</p>
          </aside>

          {/* Content */}
          <main className="flex-1 min-w-0 flex flex-col">
            {/* Mobile header (md: hidden) */}
            <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center">
                  <Receipt size={13} className="text-white" />
                </div>
                <span className="text-sm font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  ArcReceipt
                </span>
              </div>
              <ConnectKitButton />
            </header>

            {/* Page content */}
            <div className="flex-1 px-4 md:px-6 py-5 max-w-4xl w-full mx-auto">
              <Outlet />
            </div>

            {/* Mobile bottom nav */}
            <nav className="md:hidden flex border-t border-slate-200 bg-white/90 backdrop-blur-sm">
              {NAV_ITEMS.map(({ to, label, icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                      isActive ? 'text-emerald-600' : 'text-slate-500'
                    }`
                  }
                >
                  {icon}
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </main>
        </div>
      </div>
    </MerchantGate>
  )
}
