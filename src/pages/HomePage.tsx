/**
 * HomePage — public landing at "/".
 * Rendered inside CustomerLayout which provides the header + wallet button.
 * Customer-only. Merchant bookmarks /merchant directly — no link needed here.
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, FileText, ArrowRight, ShieldCheck,
  AlertCircle, ScanLine, ChevronRight,
} from 'lucide-react'
import { useAccount } from 'wagmi'
import { ARC_TESTNET_ID } from '@/lib/contract'

// ── URL / ID parser ───────────────────────────────────────────────────────────

interface Parsed { id: bigint; type: 'pay' | 'receipt' }

function parseInput(raw: string): Parsed | null {
  const s = raw.trim()
  if (!s) return null

  if (/^\d+$/.test(s)) {
    try { const n = BigInt(s); if (n > 0n) return { id: n, type: 'pay' } } catch { /**/ }
    return null
  }

  try {
    const urlStr = s.startsWith('/') ? `https://x.com${s}` : s
    const u = new URL(urlStr)
    const parts = u.pathname.replace(/\/$/, '').split('/')
    if (parts.length >= 2 && parts[parts.length - 2] === 'pay') {
      const n = BigInt(parts[parts.length - 1]); if (n > 0n) return { id: n, type: 'pay' }
    }
    if (parts.length >= 2 && parts[parts.length - 2] === 'receipt') {
      const n = BigInt(parts[parts.length - 1]); if (n > 0n) return { id: n, type: 'receipt' }
    }
    const req = u.searchParams.get('request')
    const view = u.searchParams.get('view')
    if (req) {
      const n = BigInt(req); if (n > 0n) return { id: n, type: view === 'receipt' ? 'receipt' : 'pay' }
    }
  } catch { /**/ }

  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleLookup = useCallback(() => {
    const parsed = parseInput(input)
    if (!parsed) { setError('Enter a request ID or paste a payment link.'); return }
    setError(null)
    void navigate(parsed.type === 'receipt' ? `/receipt/${parsed.id}` : `/pay/${parsed.id}`)
  }, [input, navigate])

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLookup()
  }, [handleLookup])

  return (
    <div className="space-y-4 pt-1 pb-10">

      {/* ── Tagline ───────────────────────────────────────────────────────── */}
      <div className="space-y-1 pt-1">
        <h1
          className="text-2xl font-bold text-slate-900 tracking-tight leading-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.03em' }}
        >
          Pay. Verify. Done.
        </h1>
        <p className="text-sm text-slate-500 leading-snug">
          USDC payments on Arc Testnet — every receipt verified onchain.
        </p>
        <span className="inline-block text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-0.5 font-medium">
          Arc Testnet · Chain {ARC_TESTNET_ID} · USDC
        </span>
      </div>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#CBD5E1] bg-slate-50 px-4 py-3.5 space-y-2.5 shadow-sm">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-widest">How it works</p>
        <div className="space-y-2.5">
          {[
            { step: '1', text: 'Merchant builds the order in the Sell screen' },
            { step: '2', text: 'Each order gets a unique QR — customer scans and pays in USDC' },
            { step: '3', text: 'Payment and receipt are verified onchain — no trust required' },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-white text-xs font-bold leading-none">{step}</span>
              </div>
              <p className="text-xs text-slate-700 leading-snug">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Connected wallet card ─────────────────────────────────────────── */}
      {isConnected && address ? (
        <button
          onClick={() => void navigate('/payments')}
          className="w-full flex items-center justify-between gap-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-2xl px-4 py-4 transition-all shadow-md shadow-emerald-200"
        >
          <div className="text-left">
            <p className="text-xs text-emerald-200 font-medium">Connected wallet</p>
            <p className="text-sm font-semibold font-mono">
              {address.slice(0, 8)}…{address.slice(-6)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-white/15 rounded-xl px-3 py-2">
            <FileText size={14} />
            <span className="text-sm font-semibold">My payments</span>
            <ChevronRight size={14} />
          </div>
        </button>
      ) : (
        <div className="flex items-center gap-3 bg-slate-100 rounded-2xl px-4 py-3.5">
          <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
            <FileText size={15} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">View your payments</p>
            <p className="text-xs text-slate-400 mt-0.5">Connect your wallet to see your history.</p>
          </div>
        </div>
      )}

      {/* ── Receipt / Payment lookup ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#CBD5E1] shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-[#CBD5E1]">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-emerald-600" />
            <p className="text-sm font-semibold text-slate-800">Find a receipt or payment</p>
          </div>
        </div>
        <div className="px-4 py-3 space-y-2.5">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={input}
              onChange={e => { setInput(e.target.value); setError(null) }}
              onKeyDown={handleKey}
              placeholder="Request ID or paste a link…"
              className="flex-1 rounded-xl border border-[#CBD5E1] bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 focus:bg-white transition min-w-0"
            />
            <button
              onClick={handleLookup}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-sm font-semibold transition-all flex items-center gap-1.5"
            >
              <ArrowRight size={15} />
              <span>Go</span>
            </button>
          </div>
          {error ? (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
              <AlertCircle size={12} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Amount and merchant are read from the contract — never from the URL.
            </p>
          )}
        </div>
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => void navigate('/verify')}
          className="group bg-white rounded-2xl border border-[#CBD5E1] hover:border-emerald-400 hover:shadow-md p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center mb-3 transition-colors">
            <ShieldCheck size={16} className="text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-800">Verify</p>
          <p className="text-xs text-slate-600 mt-0.5">Check any request onchain</p>
        </button>

        <button
          onClick={() => void navigate('/payments')}
          className="group bg-white rounded-2xl border border-[#CBD5E1] hover:border-emerald-400 hover:shadow-md p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center mb-3 transition-colors">
            <FileText size={16} className="text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-800">My payments</p>
          <p className="text-xs text-slate-600 mt-0.5">Payments from your wallet</p>
        </button>
      </div>

      {/* ── Scan hint ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50 border border-[#CBD5E1] px-4 py-3.5">
        <ScanLine size={18} className="text-slate-500 shrink-0" />
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">Have a QR code?</span>{' '}
          Scan it with your camera — it opens the payment page directly.
        </p>
      </div>

    </div>
  )
}
