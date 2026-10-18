/**
 * /merchant/settings — Merchant settings (stub for Part 2/3).
 * Will hold menu preset management in Part 2.
 */
import { Settings, Info } from 'lucide-react'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import { ARC_TESTNET_CHAIN_ID } from '@/onchain-facts'
import { CONTRACT_ADDRESS } from '@/lib/contract'

export default function MerchantSettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Settings
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Workspace configuration</p>
      </div>

      {/* Deployment info */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Info size={15} className="text-slate-400" />
          <p className="text-sm font-semibold text-slate-800">Deployment</p>
        </div>
        <div className="space-y-1.5 text-xs text-slate-600">
          <Row label="Chain" value={`Arc Testnet (${ARC_TESTNET_CHAIN_ID})`} />
          <Row label="Contract" value={CONTRACT_ADDRESS} mono />
          <Row
            label="Merchant wallet"
            value={MERCHANT_ADDRESS ?? 'Not configured'}
            mono={!!MERCHANT_ADDRESS}
          />
        </div>
      </div>

      {/* Menu presets placeholder */}
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-3">
        <Settings size={28} className="mx-auto text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">Menu preset management coming in Part 2</p>
        <p className="text-xs text-slate-400">
          Edit menu items and prices directly from Settings in Part 2.
          Currently they can be edited inline in the Sell screen.
        </p>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
