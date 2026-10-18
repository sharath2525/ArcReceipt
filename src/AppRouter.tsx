/**
 * AppRouter — React Router v6 route tree.
 *
 * Two distinct layout trees:
 *   /merchant/*   → MerchantLayout (gated by MerchantGate)
 *   customer       → CustomerLayout (always open)
 *
 * Customer payment links always open the customer layout, regardless of
 * which wallet is connected. There is no automatic redirect into the
 * merchant workspace based on wallet identity.
 *
 * Legacy query-string URLs are handled by LegacyRedirect at "/".
 */
import { Routes, Route } from 'react-router-dom'

import { MerchantLayout }  from '@/components/MerchantLayout'
import { CustomerLayout }  from '@/components/CustomerLayout'
import LegacyRedirect       from '@/pages/LegacyRedirect'

// Merchant pages
import MerchantSellPage         from '@/pages/merchant/MerchantSellPage'
import MerchantTodayPage        from '@/pages/merchant/MerchantTodayPage'
import MerchantOrdersPage       from '@/pages/merchant/MerchantOrdersPage'
import MerchantOrderDetailPage  from '@/pages/merchant/MerchantOrderDetailPage'
import MerchantReportsPage      from '@/pages/merchant/MerchantReportsPage'
import MerchantSettingsPage     from '@/pages/merchant/MerchantSettingsPage'
import MerchantDemoPage         from '@/pages/merchant/MerchantDemoPage'

// Customer pages
import PayPage      from '@/pages/customer/PayPage'
import ReceiptPage  from '@/pages/customer/ReceiptPage'
import PaymentsPage from '@/pages/customer/PaymentsPage'
import VerifyPage   from '@/pages/customer/VerifyPage'

export default function AppRouter() {
  return (
    <Routes>
      {/* ── Merchant workspace ──────────────────────────────────────────── */}
      <Route path="/merchant" element={<MerchantLayout />}>
        <Route index element={<MerchantSellPage />} />
        <Route path="today"           element={<MerchantTodayPage />} />
        <Route path="orders"          element={<MerchantOrdersPage />} />
        <Route path="orders/:requestId" element={<MerchantOrderDetailPage />} />
        <Route path="reports"         element={<MerchantReportsPage />} />
        <Route path="settings"        element={<MerchantSettingsPage />} />
        <Route path="demo"            element={<MerchantDemoPage />} />
      </Route>

      {/* ── Customer experience ─────────────────────────────────────────── */}
      <Route element={<CustomerLayout />}>
        <Route path="/pay/:requestId"     element={<PayPage />} />
        <Route path="/receipt/:requestId" element={<ReceiptPage />} />
        <Route path="/payments"           element={<PaymentsPage />} />
        <Route path="/verify"             element={<VerifyPage />} />
      </Route>

      {/* ── Legacy query-string redirect + root ─────────────────────────── */}
      {/* Catches "/" with any query string (old ?request=N links etc.)      */}
      <Route path="/" element={<LegacyRedirect />} />

      {/* ── 404 fallback — render in customer layout ─────────────────────── */}
      <Route element={<CustomerLayout />}>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="mt-8 text-center space-y-2">
      <p className="text-slate-600 font-semibold">Page not found</p>
      <p className="text-xs text-slate-400">Check the URL or go back.</p>
    </div>
  )
}
