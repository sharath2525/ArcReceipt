/**
 * SellPage — ArcReceipt Shop
 *
 * Merchant-operated point-of-sale for a small food stall.
 * The shopkeeper selects items → builds a cart → creates a USDC payment
 * request onchain → shows a large QR for the customer to scan.
 *
 * Spec: §3.1 SELL + PRODUCT section (shop UI addition).
 *
 * Key data-honesty rules enforced here:
 *   - Item names/prices are LOCAL MERCHANT PRESETS, not onchain data.
 *   - Payment terms (amount, expiry, merchant) are written to the contract
 *     at creation time and are immutable thereafter.
 *   - Cart details are persisted to sessionStorage keyed by
 *     chainId+contract+merchant so they survive a refresh but are isolated
 *     per account. They are NEVER used to verify payment status.
 *   - Public checkout reads amount, merchant, expiry and status from the
 *     contract. URL parameters are never trusted for payment terms.
 *   - Equal cart totals produce different request IDs (enforced by contract).
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { TokenUSDC } from '@web3icons/react'
import {
  Plus, Minus, X, ShoppingCart, CheckCircle, ExternalLink,
  Loader2, AlertCircle, QrCode, Copy, ArrowRight, RefreshCw,
  UtensilsCrossed, Pencil, ChevronDown, ChevronUp,
} from 'lucide-react'
import { parseUsdc, formatUsdc } from '@/onchain-money'
import { buildTxExplorerUrl } from '@/onchain-facts'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID,
  extractIdFromReceipt, buildPaymentLink, buildReceiptLink,
} from '@/lib/contract'
import { savePendingTx, loadPendingTx, clearPendingTx } from '@/lib/pending-tx'
import { formatAddr } from '@/lib/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string
  name: string
  price: string      // human USDC string, e.g. "2" or "2.50"
  emoji: string
  imageUrl?: string  // optional photo URL set in Settings
  unavailable?: boolean  // set in Settings; hidden from Sell screen
}

export interface CartItem {
  menuId: string
  name: string
  price: string   // frozen at add-time
  qty: number
}

// ─── Error decoder ────────────────────────────────────────────────────────────
function decodeTxError(msg: string): string {
  if (/user rejected|User rejected|4001/i.test(msg)) return 'Rejected in wallet.'
  if (/insufficient funds|InsufficientFunds/i.test(msg)) return 'Insufficient balance for gas.'
  if (/ZeroAmount/i.test(msg)) return 'Amount must be greater than zero.'
  if (/ExpiryMustBeFuture/i.test(msg)) return 'Expiry must be in the future.'
  if (/ExpiryTooFar/i.test(msg)) return 'Expiry is too far ahead (max 30 days).'
  if (/RequestNotFound/i.test(msg)) return 'Request not found.'
  if (/RequestNotOpen/i.test(msg)) return 'Request is no longer open.'
  if (/RequestExpired/i.test(msg)) return 'Request has expired.'
  if (/network changed|underlying network/i.test(msg)) return 'Network changed — switch back to Arc Testnet.'
  if (/timeout|fetch failed|RPC/i.test(msg)) return 'Network error — check connection and retry.'
  return msg.replace(/^[\w.]+Error:\s*/i, '').slice(0, 120)
}

// ─── Default menu presets ─────────────────────────────────────────────────────
// Sample prices only — not representative of any real business.

const DEFAULT_MENU: MenuItem[] = [
  { id: 'burger', name: 'Burger',  price: '2',   emoji: '🍔' },
  { id: 'coke',   name: 'Coke',    price: '3',   emoji: '🥤' },
  { id: 'fries',  name: 'Fries',   price: '1',   emoji: '🍟' },
  { id: 'coffee', name: 'Coffee',  price: '2',   emoji: '☕' },
]

// ─── Decimal-safe USDC arithmetic ────────────────────────────────────────────

/** Returns total raw USDC for a cart. Throws if any item has invalid price. */
function cartTotal(items: CartItem[]): bigint {
  return items.reduce((sum, item) => {
    return sum + parseUsdc(item.price) * BigInt(item.qty)
  }, 0n)
}

// ─── SessionStorage helpers ───────────────────────────────────────────────────

function cartKey(account: string): string {
  return `arc-receipt:cart:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}

/**
 * Clear the cart for a given account.
 * Exported so callers outside SellPage (e.g. MerchantOrderDetailPage "Next order")
 * can reset the cart before navigating back to /merchant, ensuring a fresh
 * empty cart is shown rather than the previous order's items.
 */
export function clearCartForAccount(account: string): void {
  try { sessionStorage.removeItem(cartKey(account)) } catch { /* ignore */ }
}
function menuKey(account: string): string {
  return `arc-receipt:menu:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}

// Menu is stored in localStorage (survives browser restarts — durable operator config).
// Cart remains in sessionStorage (session-scoped draft, intentionally transient).

// Persists the confirmed order so it survives a page refresh.
// Scoped by chain + contract + merchant.
interface ConfirmedOrder {
  requestId: string  // bigint serialised as decimal string
  txHash: `0x${string}`
  frozenAmount: string  // bigint serialised as decimal string
  frozenCart: CartItem[]
}
function confirmedOrderKey(account: string): string {
  return `arc-receipt:confirmed:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}
function saveConfirmedOrder(account: string, order: ConfirmedOrder): void {
  try { sessionStorage.setItem(confirmedOrderKey(account), JSON.stringify(order)) } catch { /* ignore */ }
}
function loadConfirmedOrder(account: string): ConfirmedOrder | null {
  try {
    const raw = sessionStorage.getItem(confirmedOrderKey(account))
    if (!raw) return null
    return JSON.parse(raw) as ConfirmedOrder
  } catch { return null }
}
function clearConfirmedOrder(account: string): void {
  try { sessionStorage.removeItem(confirmedOrderKey(account)) } catch { /* ignore */ }
}

// Also persist the frozen cart/amount alongside the pending TX so refresh
// can reconstruct the "Confirming order…" screen with correct values.
interface PendingOrderSnapshot {
  frozenCart: CartItem[]
  frozenAmount: string  // bigint as decimal string
}
function pendingSnapshotKey(account: string): string {
  return `arc-receipt:pending-snap:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}
function savePendingSnapshot(account: string, snap: PendingOrderSnapshot): void {
  try { sessionStorage.setItem(pendingSnapshotKey(account), JSON.stringify(snap)) } catch { /* ignore */ }
}
function loadPendingSnapshot(account: string): PendingOrderSnapshot | null {
  try {
    const raw = sessionStorage.getItem(pendingSnapshotKey(account))
    if (!raw) return null
    return JSON.parse(raw) as PendingOrderSnapshot
  } catch { return null }
}
function clearPendingSnapshot(account: string): void {
  try { sessionStorage.removeItem(pendingSnapshotKey(account)) } catch { /* ignore */ }
}

// ─── Cart/menu data validation (C: reject invalid stored data) ───────────────

/**
 * Returns true only when the price string is a valid unsigned decimal USDC
 * value (max 6 dp) representing a positive non-zero amount.
 * Used to sanitize menu items loaded from sessionStorage.
 */
function isValidMenuPrice(price: unknown): boolean {
  if (typeof price !== 'string') return false
  // Must match unsigned decimal pattern with at most 6 dp
  if (!/^\d+(\.\d{1,6})?$/.test(price.trim())) return false
  try {
    const raw = parseUsdc(price.trim())
    return raw > 0n
  } catch {
    return false
  }
}

function sanitizeMenuItem(item: unknown): MenuItem | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  if (!isValidMenuPrice(o.price)) return null
  const imageUrl = typeof o.imageUrl === 'string' && o.imageUrl.trim().startsWith('http')
    ? o.imageUrl.trim() : undefined
  return {
    id: o.id,
    name: o.name,
    price: String(o.price).trim(),
    emoji: typeof o.emoji === 'string' ? o.emoji : '🍽',
    imageUrl,
    unavailable: typeof o.unavailable === 'boolean' ? o.unavailable : false,
  }
}

function sanitizeCartItem(item: unknown): CartItem | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  if (typeof o.menuId !== 'string') return null
  if (typeof o.name !== 'string') return null
  if (!isValidMenuPrice(o.price)) return null
  const qty = typeof o.qty === 'number' ? Math.floor(o.qty) : 0
  if (qty <= 0) return null
  return {
    menuId: o.menuId,
    name: o.name,
    price: String(o.price).trim(),
    qty,
  }
}

function loadCart(account: string): CartItem[] {
  try {
    const raw = sessionStorage.getItem(cartKey(account))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeCartItem).filter((x): x is CartItem => x !== null)
  } catch { return [] }
}
function saveCart(account: string, cart: CartItem[]): void {
  try { sessionStorage.setItem(cartKey(account), JSON.stringify(cart)) } catch { /* ignore */ }
}
function loadMenu(account: string): MenuItem[] {
  try {
    // localStorage for durable menu — survives browser restarts.
    const raw = localStorage.getItem(menuKey(account))
    if (!raw) return DEFAULT_MENU
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return DEFAULT_MENU
    const valid = parsed.map(sanitizeMenuItem).filter((x): x is MenuItem => x !== null)
    // Fall back to defaults if validation produces an empty menu
    return valid.length > 0 ? valid : DEFAULT_MENU
  } catch { return DEFAULT_MENU }
}
function saveMenu(account: string, menu: MenuItem[]): void {
  try { localStorage.setItem(menuKey(account), JSON.stringify(menu)) } catch { /* ignore */ }
}

// ─── MenuCard ─────────────────────────────────────────────────────────────────

function MenuCard({
  item, onAdd, editingId, onEditStart, onEditSave, onEditCancel,
}: {
  item: MenuItem
  onAdd: (item: MenuItem) => void
  editingId: string | null
  onEditStart: (id: string) => void
  onEditSave: (id: string, name: string, price: string, emoji: string) => void
  onEditCancel: () => void
}) {
  const [eName, setEName]   = useState(item.name)
  const [ePrice, setEPrice] = useState(item.price)
  const [eEmoji, setEEmoji] = useState(item.emoji)
  const isEditing = editingId === item.id

  if (isEditing) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
        <div className="flex gap-2">
          <input value={eEmoji} onChange={e => setEEmoji(e.target.value)}
            className="w-10 text-center rounded-lg border border-slate-200 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            maxLength={2} placeholder="🍔"
          />
          <input value={eName} onChange={e => setEName(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            placeholder="Item name"
          />
        </div>
        <div className="flex gap-2 items-center">
          <TokenUSDC variant="branded" size={14} />
          <input type="number" min="0" step="0.01" value={ePrice}
            onChange={e => setEPrice(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            placeholder="0.00"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!eName.trim()) { toast.error('Name required'); return }
              // C: strict parseUsdc — rejects negatives, hex, sci notation
              try {
                const raw = parseUsdc(ePrice.trim())
                if (raw <= 0n) { toast.error('Price must be greater than zero'); return }
              } catch { toast.error('Invalid price — enter a positive decimal number'); return }
              onEditSave(item.id, eName.trim(), ePrice.trim(), eEmoji || '🍽')
            }}
            className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
          >Save</button>
          <button onClick={onEditCancel}
            className="flex-1 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200"
          >Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white hover:border-emerald-200 hover:shadow-sm transition-all overflow-hidden group">
      <button
        onClick={() => onAdd(item)}
        className="w-full p-4 flex flex-col items-center gap-2 active:bg-emerald-50"
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-14 h-14 rounded-xl object-cover border border-slate-100"
            onError={e => { (e.currentTarget).style.display = 'none' }}
          />
        ) : (
          <span className="text-3xl">{item.emoji}</span>
        )}
        <span className="font-semibold text-slate-800 text-sm">{item.name}</span>
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <TokenUSDC variant="branded" size={12} /> {item.price} USDC
        </span>
      </button>
      <div className="border-t border-slate-50 flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => onAdd(item)}
          className="flex-1 flex items-center justify-center gap-1 text-xs text-emerald-600 font-semibold hover:bg-emerald-50 rounded-lg py-1"
        >
          <Plus size={12} /> Add
        </button>
        <button
          onClick={() => onEditStart(item.id)}
          className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg hover:bg-slate-50"
          title="Edit item"
        >
          <Pencil size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── CartRow ──────────────────────────────────────────────────────────────────

function CartRow({
  item, onInc, onDec, onRemove,
}: {
  item: CartItem
  onInc: () => void
  onDec: () => void
  onRemove: () => void
}) {
  const lineTotal = parseUsdc(item.price) * BigInt(item.qty)
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="flex-1 text-sm text-slate-800 font-medium">{item.name}</span>
      <div className="flex items-center gap-1.5">
        <button onClick={onDec}
          className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
          <Minus size={11} className="text-slate-600" />
        </button>
        <span className="text-sm font-semibold text-slate-800 w-5 text-center">{item.qty}</span>
        <button onClick={onInc}
          className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
          <Plus size={11} className="text-slate-600" />
        </button>
      </div>
      <span className="text-sm text-slate-600 w-16 text-right font-mono">
        {formatUsdc(lineTotal)} <span className="text-slate-400 text-xs">USDC</span>
      </span>
      <button onClick={onRemove}
        className="text-slate-300 hover:text-red-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  )
}

// ─── ConfirmedOrderCard ────────────────────────────────────────────────────────

function ConfirmedOrderCard({
  requestId, amount, paymentLink, receiptLink, txHash, cartItems,
  onNextOrder,
}: {
  requestId: bigint
  amount: bigint
  paymentLink: string
  receiptLink: string
  txHash: `0x${string}`
  cartItems: CartItem[]
  onNextOrder: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [showItems, setShowItems] = useState(false)
  const explorerUrl = buildTxExplorerUrl(ARC_TESTNET_ID, txHash)

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(paymentLink).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }, [paymentLink])

  return (
    <div className="rounded-2xl border border-emerald-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-emerald-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <CheckCircle size={18} />
          <span className="font-semibold text-sm">Order #{requestId.toString()} created</span>
        </div>
        <span className="text-emerald-100 text-sm font-mono">{formatUsdc(amount)} USDC</span>
      </div>

      {/* Large QR */}
      <div className="px-6 py-6 flex flex-col items-center gap-4 bg-white">
        <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
          <QRCodeSVG value={paymentLink} size={220} bgColor="#ffffff" fgColor="#0f172a" level="M" />
        </div>
        <p className="text-xs text-slate-400 text-center">Customer scans to pay</p>

        {/* Disclosure: local items vs onchain terms */}
        {cartItems.length > 0 && (
          <div className="w-full rounded-xl bg-slate-50 border border-slate-100 overflow-hidden">
            <button
              onClick={() => setShowItems(s => !s)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-slate-500 font-medium"
            >
              <span>Order items (merchant reference only)</span>
              {showItems ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showItems && (
              <div className="px-3 pb-3 space-y-1 border-t border-slate-100 pt-2">
                {cartItems.map((ci, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-600">
                    <span>{ci.name} × {ci.qty}</span>
                    <span className="font-mono">{formatUsdc(parseUsdc(ci.price) * BigInt(ci.qty))} USDC</span>
                  </div>
                ))}
                <p className="text-xs text-slate-400 pt-1 border-t border-slate-100 mt-1">
                  Item details are local notes — not stored onchain. Payment amount is recorded
                  on Arc Testnet and cannot be changed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 space-y-2">
        <div className="flex gap-2">
          <button onClick={copy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 transition-colors">
            {copied ? <CheckCircle size={14} className="text-emerald-500" /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <a href={paymentLink} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 transition-colors">
            <ArrowRight size={14} /> Open checkout
          </a>
        </div>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 py-1">
          <ExternalLink size={11} /> Explorer: {txHash.slice(0, 10)}…{txHash.slice(-6)}
        </a>
        <a href={receiptLink} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-emerald-600 hover:underline py-1">
          <ExternalLink size={11} /> Receipt link (share after payment)
        </a>
        <button onClick={onNextOrder}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
          <RefreshCw size={14} /> Next order
        </button>
      </div>
    </div>
  )
}

// ─── SellPage ─────────────────────────────────────────────────────────────────

interface SellPageProps {
  /** Called when a request is confirmed onchain. The parent navigates to the
   *  merchant order view which reads QR data from the chain — no sessionStorage. */
  onOrderCreated?: (requestId: bigint) => void
}

export function SellPage({ onOrderCreated }: SellPageProps) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  // ── Menu state ───────────────────────────────────────────────────────────────
  const [menu, setMenu] = useState<MenuItem[]>(() =>
    address ? loadMenu(address) : DEFAULT_MENU
  )
  const [editingId, setEditingId] = useState<string | null>(null)

  // ── Cart state ───────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>(() =>
    address ? loadCart(address) : []
  )
  const [customAmount, setCustomAmount] = useState('')
  const [expirySeconds, setExpirySeconds] = useState(1800)  // default 30m

  // Reload cart/menu when account changes
  useEffect(() => {
    if (!address) return
    setMenu(loadMenu(address))
    setCart(loadCart(address))
  }, [address])

  // Persist cart whenever it changes
  useEffect(() => {
    if (address) saveCart(address, cart)
  }, [cart, address])

  // ── Add/modify cart ──────────────────────────────────────────────────────────
  const addItem = useCallback((item: MenuItem) => {
    setCart(prev => {
      const existing = prev.findIndex(c => c.menuId === item.id && c.price === item.price)
      if (existing >= 0) {
        return prev.map((c, i) => i === existing ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, { menuId: item.id, name: item.name, price: item.price, qty: 1 }]
    })
  }, [])

  const incItem = useCallback((idx: number) => {
    setCart(prev => prev.map((c, i) => i === idx ? { ...c, qty: c.qty + 1 } : c))
  }, [])

  const decItem = useCallback((idx: number) => {
    setCart(prev => {
      const updated = prev.map((c, i) => i === idx ? { ...c, qty: c.qty - 1 } : c)
      return updated.filter(c => c.qty > 0)
    })
  }, [])

  const removeItem = useCallback((idx: number) => {
    setCart(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const addCustom = useCallback(() => {
    const p = customAmount.trim()
    if (!p) { toast.error('Enter an amount'); return }
    // C: use parseUsdc as the primary guard — rejects negatives, hex, sci notation
    let raw: bigint
    try { raw = parseUsdc(p) } catch { toast.error('Invalid amount — enter a positive decimal number'); return }
    if (raw <= 0n) { toast.error('Amount must be greater than zero'); return }
    setCart(prev => [...prev, { menuId: 'custom', name: 'Custom', price: p, qty: 1 }])
    setCustomAmount('')
  }, [customAmount])

  // ── Menu editing ─────────────────────────────────────────────────────────────
  const handleEditSave = useCallback((id: string, name: string, price: string, emoji: string) => {
    setMenu(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, name, price, emoji } : m)
      if (address) saveMenu(address, updated)
      return updated
    })
    setEditingId(null)
  }, [address])

  // ── Transaction state ────────────────────────────────────────────────────────
  const [pendingHash, setPendingHash]       = useState<`0x${string}` | undefined>()
  const [frozenCart, setFrozenCart]         = useState<CartItem[]>([])
  // frozenAmount: the exact raw amount submitted to the contract.
  // Used on the confirmed card — never replaced by the live cart total.
  const [frozenAmount, setFrozenAmount]     = useState<bigint>(0n)
  const [confirmedId, setConfirmedId]       = useState<bigint | null>(null)
  const [confirmedTx, setConfirmedTx]       = useState<`0x${string}` | undefined>()
  const [txError, setTxError]               = useState<string | null>(null)
  const [reviewMode, setReviewMode]         = useState(false)
  const [_txReverted, setTxReverted]         = useState(false)

  // B2+B3 FIX: Restore confirmed order AND pending tracking after wallet
  // reconnects. On Vercel, wagmi's shimDisconnect reconnects asynchronously
  // so address is undefined at useState init time.
  useEffect(() => {
    if (!address) return
    // First check for a persisted confirmed order (B3).
    // Only restore if onOrderCreated is NOT provided — when it is, the parent
    // owns navigation and the persisted confirmed order is stale. Clear it so
    // the Sell tab always starts fresh after a successful order creation.
    const confirmed = loadConfirmedOrder(address)
    if (confirmed && !confirmedId) {
      if (onOrderCreated) {
        // Parent will navigate to MerchantOrderView on creation; clearing here
        // prevents SellPage from showing an old QR card on next Sell tab visit.
        clearConfirmedOrder(address)
      } else {
        setConfirmedId(BigInt(confirmed.requestId))
        setConfirmedTx(confirmed.txHash)
        setFrozenAmount(BigInt(confirmed.frozenAmount))
        setFrozenCart(confirmed.frozenCart)
        return  // confirmed state is authoritative — no need to restore pending
      }
    }
    // Then check for a pending hash (B2)
    if (pendingHash) return
    const saved = loadPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address, 'createRequest')
    if (saved?.hash) {
      // Restore the frozen snapshot so the confirming screen shows correct amount
      const snap = loadPendingSnapshot(address)
      if (snap) {
        setFrozenAmount(BigInt(snap.frozenAmount))
        setFrozenCart(snap.frozenCart)
      }
      setPendingHash(saved.hash)
      processedRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Derive cart total safely
  let total = 0n
  let totalError = ''
  try { total = cartTotal(cart) } catch (e) {
    totalError = e instanceof Error ? e.message : 'Invalid cart'
  }

  // ── Expiry presets ───────────────────────────────────────────────────────────
  const EXPIRY_OPTS = [
    { label: '5m',  s: 5 * 60 },
    { label: '15m', s: 15 * 60 },
    { label: '30m', s: 30 * 60 },
    { label: '1d',  s: 86_400 },
  ]

  // ── Write contract ───────────────────────────────────────────────────────────
  const { writeContract, isPending: isWalletPending } = useWriteContract()

  const { data: receipt, isLoading: isConfirming, isError: receiptError } =
    useWaitForTransactionReceipt({
      hash: pendingHash,
      chainId: ARC_TESTNET_ID,
      pollingInterval: 1_500,
      confirmations: 1,
      timeout: 60_000,
    })

  // Process receipt exactly once per hash using the same useEffect+ref pattern
  // as MerchantDashboard. The ref guard prevents double-processing on re-renders.
  const processedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingHash || !receipt || processedRef.current === pendingHash) return
    processedRef.current = pendingHash
    if (receipt.status === 'success') {
      const id = extractIdFromReceipt(receipt)
      setConfirmedId(id)
      setConfirmedTx(pendingHash)
      clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
      if (address) clearPendingSnapshot(address)
      toast.success(`Order #${id ?? '?'} created`)
      // When a parent navigation callback is provided (always the case in
      // ArcReceiptApp), delegate the QR view immediately and do NOT persist
      // a confirmedOrder to sessionStorage. The parent navigates to
      // MerchantOrderView which reads chain state — no local cache needed.
      // Persisting would cause SellPage to restore the old order card the
      // next time the merchant returns to the Sell tab, which is wrong.
      if (id !== null && onOrderCreated) {
        if (address) clearConfirmedOrder(address)
        onOrderCreated(id)
        return
      }
      // Fallback: no parent callback (standalone use) — persist so the QR
      // card survives a refresh within SellPage itself.
      if (id !== null && address) {
        saveConfirmedOrder(address, {
          requestId: id.toString(),
          txHash: pendingHash,
          frozenAmount: frozenAmount.toString(),
          frozenCart,
        })
      }
    } else {
      setTxError('Transaction reverted — order not created.')
      setTxReverted(true)
      setPendingHash(undefined)
      clearPendingTx(ARC_TESTNET_ID, CONTRACT_ADDRESS, address ?? '', 'createRequest')
      if (address) clearPendingSnapshot(address)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, pendingHash])

  useEffect(() => {
    // B1 FIX: a transient RPC/timeout error must NOT mark the hash processed.
    // Leave processedRef.current untouched so a later valid receipt still fires.
    if (!receiptError || !pendingHash) return
    setTxError('Could not confirm — check explorer for status. Retrying…')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptError, pendingHash])

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleCreateOrder = useCallback(() => {
    if (!address) { toast.error('Connect your wallet first'); return }
    if (chainId !== ARC_TESTNET_ID) { switchChain({ chainId: ARC_TESTNET_ID }); return }
    if (cart.length === 0 || total === 0n) { toast.error('Cart is empty'); return }
    if (totalError) { toast.error(totalError); return }
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + expirySeconds)
    const frozenSnapshot = [...cart]
    const meta = { amount: formatUsdc(total), expiryKey: String(expirySeconds) }
    writeContract(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'createRequest',
        args: [total, expiresAt],
        chainId: ARC_TESTNET_ID,
      },
      {
        onSuccess: (txHash) => {
          savePendingTx({ chainId: ARC_TESTNET_ID, contract: CONTRACT_ADDRESS, account: address, action: 'createRequest', hash: txHash, meta })
          // B2 FIX: also persist the frozen snapshot so refresh can reconstruct
          // the "Confirming order…" screen with the correct amount.
          savePendingSnapshot(address, { frozenCart: frozenSnapshot, frozenAmount: total.toString() })
          setFrozenCart(frozenSnapshot)
          setFrozenAmount(total)   // freeze the exact submitted amount
          setPendingHash(txHash)
          setTxError(null)
          setReviewMode(false)
          processedRef.current = null
          toast.success('Submitted — confirming…')
        },
        onError: (e) => {
          const msg = decodeTxError(e.message)
          setTxError(msg)
          toast.error(msg)
        },
      }
    )
  }, [address, chainId, cart, total, totalError, expirySeconds, switchChain, writeContract])

  const handleNextOrder = useCallback(() => {
    setCart([])
    setCustomAmount('')
    setPendingHash(undefined)
    setFrozenAmount(0n)
    setFrozenCart([])
    setConfirmedId(null)
    setConfirmedTx(undefined)
    setTxError(null)
    setReviewMode(false)
    setTxReverted(false)
    processedRef.current = null
    if (address) {
      saveCart(address, [])
      clearConfirmedOrder(address)
      clearPendingSnapshot(address)
    }
  }, [address])

  // ── Confirmed order view ─────────────────────────────────────────────────────
  if (confirmedId !== null && confirmedTx) {
    const link = buildPaymentLink(confirmedId)
    const rLink = buildReceiptLink(confirmedId)
    return (
      <div className="space-y-4">
        <ConfirmedOrderCard
          requestId={confirmedId}
          amount={frozenAmount || cartTotal(frozenCart)}
          paymentLink={link}
          receiptLink={rLink}
          txHash={confirmedTx}
          cartItems={frozenCart}
          onNextOrder={handleNextOrder}
        />
      </div>
    )
  }

  // ── Review before sign ───────────────────────────────────────────────────────
  if (reviewMode && cart.length > 0 && !isWalletPending && !pendingHash) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Review order</p>
            <button onClick={() => setReviewMode(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          {/* Items summary */}
          <div className="rounded-xl bg-slate-50 divide-y divide-slate-100 overflow-hidden">
            {cart.map((item, i) => (
              <div key={i} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-slate-700">{item.name} × {item.qty}</span>
                <span className="font-mono text-slate-600">{formatUsdc(parseUsdc(item.price) * BigInt(item.qty))} USDC</span>
              </div>
            ))}
            <div className="flex justify-between px-3 py-2.5 text-sm font-semibold bg-slate-100">
              <span>Total</span>
              <span className="text-emerald-700">{formatUsdc(total)} USDC</span>
            </div>
          </div>
          {/* Contract terms */}
          <div className="rounded-xl border border-slate-100 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Amount (onchain)</span>
              <span className="font-semibold text-slate-800 font-mono">{formatUsdc(total)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Expires in</span>
              <span className="text-slate-700">
                {EXPIRY_OPTS.find(o => o.s === expirySeconds)?.label ?? `${expirySeconds}s`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Network</span>
              <span className="text-slate-700">Arc Testnet (5042002)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Merchant</span>
              <span className="font-mono text-slate-700">{address ? formatAddr(address) : '—'}</span>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Creating a request requires a wallet transaction. The exact amount ({formatUsdc(total)} USDC),
            expiry and merchant address are stored onchain and cannot be changed after signing.
            Item descriptions above are local merchant notes only — not recorded onchain.
          </p>
          {txError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{txError}</p>
            </div>
          )}
          {!address ? (
            <p className="text-xs text-slate-400 text-center">Connect your wallet to continue.</p>
          ) : chainId !== ARC_TESTNET_ID ? (
            <button onClick={() => switchChain({ chainId: ARC_TESTNET_ID })}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
              <AlertCircle size={16} /> Switch to Arc Testnet
            </button>
          ) : (
            <button
              onClick={handleCreateOrder}
              disabled={isWalletPending || !!pendingHash}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isWalletPending ? <><Loader2 size={16} className="animate-spin" /> Waiting for wallet…</> : <>Create order in wallet</>}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Confirming state ─────────────────────────────────────────────────────────
  if (pendingHash && (isWalletPending || isConfirming)) {
    const explorerUrl = buildTxExplorerUrl(ARC_TESTNET_ID, pendingHash)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col items-center gap-4">
        <Loader2 size={32} className="animate-spin text-emerald-500" />
        <div className="text-center">
          <p className="font-semibold text-slate-800">Confirming order…</p>
          <p className="text-xs text-slate-400 mt-1">{formatUsdc(cartTotal(frozenCart))} USDC · Arc Testnet</p>
        </div>
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:underline">
          <ExternalLink size={12} /> {pendingHash.slice(0, 10)}…{pendingHash.slice(-6)}
        </a>
      </div>
    )
  }

  // ── Main sell view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Error banner */}
      {txError && !reviewMode && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-600">{txError}</p>
          </div>
          <button onClick={() => setTxError(null)} className="text-slate-400 hover:text-slate-600">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Two-column layout: menu + cart */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">

        {/* Menu grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-widest uppercase text-slate-400 flex items-center gap-1.5">
              <UtensilsCrossed size={12} /> Menu
            </p>
            <span className="text-xs text-slate-300">Tap to add</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {menu.filter(item => !item.unavailable).map(item => (
              <MenuCard
                key={item.id}
                item={item}
                onAdd={addItem}
                editingId={editingId}
                onEditStart={setEditingId}
                onEditSave={handleEditSave}
                onEditCancel={() => setEditingId(null)}
              />
            ))}
            {menu.length > 0 && menu.every(item => item.unavailable) && (
              <div className="col-span-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 text-center">
                All menu items are marked unavailable. Re-enable them in Settings.
              </div>
            )}
          </div>
          {/* Custom amount */}
          <div className="rounded-xl border border-dashed border-slate-200 p-3 space-y-2">
            <p className="text-xs text-slate-400 font-medium">Custom amount</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2">
                  <TokenUSDC variant="branded" size={14} />
                </span>
                <input
                  type="number" min="0" step="0.01"
                  value={customAmount}
                  onChange={e => setCustomAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustom()}
                  placeholder="0.00"
                  className="w-full pl-8 pr-2 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <button onClick={addCustom}
                className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors flex items-center gap-1">
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Cart */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-widest uppercase text-slate-400 flex items-center gap-1.5">
              <ShoppingCart size={12} /> Cart
              {cart.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                  {cart.reduce((s, c) => s + c.qty, 0)}
                </span>
              )}
            </p>
            {cart.length > 0 && (
              <button onClick={() => setCart([])}
                className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
              <ShoppingCart size={24} className="mx-auto text-slate-200 mb-2" />
              <p className="text-xs text-slate-400">Cart is empty</p>
              <p className="text-xs text-slate-300 mt-1">Tap menu items to add</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-100 bg-white p-3 space-y-0">
              {cart.map((item, i) => (
                <CartRow
                  key={i}
                  item={item}
                  onInc={() => incItem(i)}
                  onDec={() => decItem(i)}
                  onRemove={() => removeItem(i)}
                />
              ))}
              {/* Total */}
              <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Total</span>
                <span className="text-base font-bold text-emerald-700 flex items-center gap-1.5">
                  <TokenUSDC variant="branded" size={16} />
                  {formatUsdc(total)} USDC
                </span>
              </div>
            </div>
          )}

          {/* Expiry */}
          {cart.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400 font-medium">Request expires in</p>
              <div className="flex gap-1.5">
                {EXPIRY_OPTS.map(o => (
                  <button
                    key={o.s}
                    onClick={() => setExpirySeconds(o.s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      expirySeconds === o.s
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create button */}
          {cart.length > 0 && (
            <button
              onClick={() => {
                if (!address) { toast.error('Connect your wallet first'); return }
                if (cart.length === 0 || total === 0n) { toast.error('Cart is empty'); return }
                setReviewMode(true)
                setTxError(null)
              }}
              disabled={!!totalError || cart.length === 0 || total === 0n}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <QrCode size={16} /> Create order · {formatUsdc(total)} USDC
            </button>
          )}
        </div>
      </div>

      {/* Persistence note */}
      {cart.length === 0 && (
        <div className="text-center py-2 space-y-0.5">
          <p className="text-xs text-slate-300">
            Sample prices are for demonstration only — not representative of any real business.
          </p>
          <p className="text-xs text-slate-300">
            Menu is saved locally in this browser (survives restarts). Cart is session-only.
            Neither is synced across devices.
          </p>
        </div>
      )}
    </div>
  )
}
