/** Shared UI helpers — no imports from contract.ts or onchain libs. */

import type { OnchainRequest } from './contract'

export function formatAddr(a: string) {
  if (!a || a.length < 10) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function formatTs(ts: bigint) {
  if (ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleString()
}

export function formatTsShort(ts: bigint) {
  if (ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function isExpired(req: OnchainRequest): boolean {
  return BigInt(Math.floor(Date.now() / 1000)) >= req.expiresAt
}

export function statusMeta(status: 0 | 1 | 2, req?: OnchainRequest) {
  if (status === 1) return { label: 'Paid', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' }
  if (status === 2) return { label: 'Cancelled', color: 'text-rose-500', bg: 'bg-rose-50 border-rose-200' }
  if (req && isExpired(req)) return { label: 'Expired', color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200' }
  return { label: 'Open', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' }
}
