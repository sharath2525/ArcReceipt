/**
 * /merchant/orders — Order history.
 * Reuses the existing MerchantDashboard in orders mode.
 * Individual order drill-down navigates to /merchant/orders/:id.
 */
import { useNavigate } from 'react-router-dom'
import { MerchantDashboard } from '@/components/MerchantDashboard'

export default function MerchantOrdersPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        Orders
      </h1>
      <MerchantDashboard
        mode="orders"
        onNavigateToOrder={(id) => void navigate(`/merchant/orders/${id.toString()}`)}
      />
    </div>
  )
}
