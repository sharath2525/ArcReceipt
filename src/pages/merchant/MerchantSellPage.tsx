/**
 * /merchant — Sell
 * Wraps the existing SellPage inside the merchant workspace.
 * After order creation, navigates to the merchant order detail route.
 */
import { useNavigate } from 'react-router-dom'
import { SellPage } from '@/components/SellPage'

export default function MerchantSellPage() {
  const navigate = useNavigate()
  return (
    <SellPage
      onOrderCreated={(requestId) => {
        void navigate(`/merchant/orders/${requestId.toString()}`)
      }}
    />
  )
}
