/**
 * MerchantGate — guards the merchant workspace.
 *
 * Renders children only when the connected wallet is the configured merchant.
 * Shows appropriate fallback for every other access state.
 * Never trusts URL params, localStorage flags, or profile fields for access.
 * Rechecks on every render (account/network changes propagate immediately).
 */
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { ShieldOff, Settings, Wallet } from 'lucide-react'
import { getMerchantAccess, MERCHANT_ADDRESSES } from '@/lib/merchant'

interface MerchantGateProps {
  children: React.ReactNode
}

export function MerchantGate({ children }: MerchantGateProps) {
  const { address } = useAccount()
  const access = getMerchantAccess(address)

  if (access === 'authorized') {
    return <>{children}</>
  }

  if (access === 'unconfigured') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-4 text-center">
          <Settings size={32} className="mx-auto text-amber-500" />
          <div>
            <p className="text-base font-semibold text-amber-900">Merchant address not configured</p>
            <p className="text-sm text-amber-700 mt-1 text-pretty">
              Set <code className="font-mono bg-amber-100 px-1 rounded">VITE_MERCHANT_ADDRESS</code> in{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">.env</code> to a valid
              Ethereum address and restart the dev server.
            </p>
          </div>
          <p className="text-xs text-amber-600">
            This is public configuration — not a secret. It restricts the frontend
            workspace only; it does not change contract permissions.
          </p>
        </div>
      </div>
    )
  }

  if (access === 'disconnected') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm w-full rounded-2xl border border-slate-200 bg-white p-6 space-y-4 text-center">
          <Wallet size={32} className="mx-auto text-slate-400" />
          <div>
            <p className="text-base font-semibold text-slate-800">Connect merchant wallet</p>
            <p className="text-sm text-slate-500 mt-1 text-pretty">
              Connect the configured merchant wallet to access the workspace.
            </p>
          </div>
          <div className="flex justify-center">
            <ConnectKitButton />
          </div>
          <p className="text-xs text-slate-400">
            Only the configured merchant {MERCHANT_ADDRESSES.length === 1 ? 'wallet' : 'wallets'} can access this workspace.
          </p>
        </div>
      </div>
    )
  }

  // unauthorized
  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full rounded-2xl border border-rose-200 bg-rose-50 p-6 space-y-4 text-center">
        <ShieldOff size={32} className="mx-auto text-rose-400" />
        <div>
          <p className="text-base font-semibold text-rose-800">Merchant access required</p>
          <p className="text-sm text-rose-600 mt-1 text-pretty">
            This wallet does not have merchant access. Connect the configured merchant
            wallet to use this workspace.
          </p>
        </div>
        <div className="flex justify-center">
          <ConnectKitButton />
        </div>
        <p className="text-xs text-rose-500">
          Note: this gate restricts the app UI only. The contract allows any wallet to
          create its own payment requests.
        </p>
      </div>
    </div>
  )
}
