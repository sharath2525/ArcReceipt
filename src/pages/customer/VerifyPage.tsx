/**
 * /verify — Wallet-free receipt lookup by request ID.
 * Wraps VerifyPanel from MerchantDashboard (re-exported here cleanly).
 */
import { VerifyPanel } from '@/components/MerchantDashboard'

export default function VerifyPage() {
  return (
    <div className="mt-2">
      <VerifyPanel />
    </div>
  )
}
