/**
 * /merchant/demo — A/B Independence Demo (developer tool).
 * Kept outside normal selling navigation as a clearly labelled demo area.
 */
import { FlaskConical } from 'lucide-react'
import { ABDemo } from '@/components/ABDemo'

export default function MerchantDemoPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Demo
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Developer tools — not for real transactions</p>
      </div>
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-700">
        <FlaskConical size={14} className="shrink-0 mt-0.5" />
        <span>
          <strong>Demo area</strong> — Creates testnet requests to demonstrate A/B request
          independence. Not for real transactions. This screen is only accessible from within
          the merchant workspace.
        </span>
      </div>
      <ABDemo />
    </div>
  )
}
