/**
 * HomePage — public landing at "/".
 * Customer-only. No merchant section — merchant goes directly to /merchant.
 *
 * Design: Arc Light, mobile-first max-w-md, warm off-white canvas,
 * emerald primary actions, Space Grotesk display, clean card surfaces.
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Receipt, Search, FileText, ArrowRight,
  ShieldCheck, AlertCircle, Scan,
} from 'lucide-react'
import { ARC_TESTNET_ID } from '@/lib/contract'

// ── URL recogniser ────────────────────────────────────────────────────────────

interface Parsed { id: bigint; type: 'pay' | 'receipt' }

function parseInput(raw: string): Parsed | null {
  const s = raw.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    try {
      const n = BigInt(s)
      if (n > 0n) return { id: n, type: 'pay' }
    } catch { /* fall through */ }
    return null
  }
  try {
    const urlStr = s.startsWith('/') ? `https://example.com${s}` : s
    const u = new URL(urlStr)
    const parts = u.pathname.replace(/\/$/, '').split('/')
    if (parts.length >= 2 && parts[parts.length - 2] === 'pay') {
      const n = BigInt(parts[parts.length - 1])
      if (n > 0n) return { id: n, type: 'pay' }
    }
    if (parts.length >= 2 && parts[parts.length - 2] === 'receipt') {
      const n = BigInt(parts[parts.length - 1])
      if (n > 0n) return { id: n, type: 'receipt' }
    }
    const req = u.searchParams.get('request')
    const view = u.searchParams.get('view')
    if (req) {
      const n = BigInt(req)
      if (n > 0n) return { id: n, type: view === 'receipt' ? 'receipt' : 'pay' }
    }
  } catch { /* not a URL */ }
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleLookup = useCallback(() => {
    const parsed = parseInput(input)
    if (!parsed) {
      setError('Enter a request ID or paste a payment link.')
      return
    }
    setError(null)
    void navigate(parsed.type === 'receipt'
      ? `/receipt/${parsed.id.toString()}`
      : `/pay/${parsed.id.toString()}`)
  }, [input, navigate])

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLookup()
  }, [handleLookup])

  return (
    <div className="min-h-dvh bg-stone-50 flex flex-col">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-start px-4 pt-10 pb-6 max-w-md mx-auto w-full space-y-6">

        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-emerald-600 shadow-lg shadow-emerald-200 mb-1">
            <Receipt size={28} className="text-white" />
          </div>
          <h1
            className="text-3xl font-bold text-slate-900 tracking-tight"
            style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.03em' }}
          >
            ArcReceipt
          </h1>
          <p className="text-base text-slate-500 max-w-xs mx-auto leading-snug">
            USDC payments on Arc Testnet.<br />
            Scan a QR to pay. Verify any receipt onchain.
          </p>
          <span className="inline-block text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 font-medium">
            Arc Testnet · Chain {ARC_TESTNET_ID} · USDC
          </span>
        </div>

        {/* ── Receipt / Payment lookup ──────────────────────────────────── */}
        <div className="w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-emerald-600 shrink-0" />
            <p className="text-sm font-semibold text-slate-800">Find a receipt or payment</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => { setInput(e.target.value); setError(null) }}
              onKeyDown={handleKey}
              placeholder="Request ID or payment link…"
              className="flex-1 rounded-2xl border border-slate-200 bg-stone-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
            />
            <button
              onClick={handleLookup}
              className="px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-sm font-semibold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <ArrowRight size={15} />
              <span>Go</span>
            </button>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 rounded-xl px-3 py-2">
              <AlertCircle size={13} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Amount and recipient are read from the contract, not from the URL.
          </p>
        </div>

        {/* ── Action cards ─────────────────────────────────────────────── */}
        <div className="w-full grid grid-cols-2 gap-3">
          <button
            onClick={() => void navigate('/verify')}
            className="group bg-white rounded-3xl border border-slate-200 hover:border-emerald-300 hover:shadow-md p-5 text-left space-y-3 transition-all shadow-sm"
          >
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
              <ShieldCheck size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">Verify</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">Check any payment onchain</p>
            </div>
          </button>

          <button
            onClick={() => void navigate('/payments')}
            className="group bg-white rounded-3xl border border-slate-200 hover:border-emerald-300 hover:shadow-md p-5 text-left space-y-3 transition-all shadow-sm"
          >
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center transition-colors">
              <FileText size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">My payments</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">Your payment history</p>
            </div>
          </button>
        </div>

        {/* ── Scan hint ─────────────────────────────────────────────────── */}
        <div className="w-full flex items-center gap-3 bg-white rounded-3xl border border-slate-200 shadow-sm px-5 py-4">
          <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0">
            <Scan size={18} className="text-slate-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-700">Got a QR code?</p>
            <p className="text-xs text-slate-400 leading-snug mt-0.5">
              Scan it with your camera — it opens the payment page directly.
            </p>
          </div>
        </div>

      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="text-center py-5 space-y-1">
        <p className="text-xs text-slate-300">Built with Arc Studio</p>
        <p className="text-xs text-slate-300">Testnet only · Not audited · No real funds</p>
      </div>

    </div>
  )
}
