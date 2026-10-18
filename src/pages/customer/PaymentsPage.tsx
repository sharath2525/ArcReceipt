/**
 * /payments — Connected wallet's payment history.
 * Wraps MyReceipts. Wallet-scoped; switching wallets changes history.
 */
import { MyReceipts } from '@/components/MyReceipts'

export default function PaymentsPage() {
  return (
    <div className="mt-2 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-800">My Payments</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Payments made by your connected wallet on Arc Testnet.
        </p>
      </div>
      <MyReceipts />
    </div>
  )
}
