/**
 * /merchant/settings — Merchant settings with full menu management.
 *
 * Part 2 addition (B):
 *   - Add, edit, remove, and reorder menu presets.
 *   - Mark items as unavailable (hidden from Sell screen).
 *   - Inline editing preserved as shortcut in SellPage.
 *   - Sample items clearly labelled as demonstration prices.
 *   - All stored data validated; corrupt/missing storage handled safely.
 *   - Data scoped by chain + contract + merchant (same keys as SellPage).
 *   - Editing prices here never silently alters existing cart items or
 *     submitted snapshots — those are frozen at add/submit time.
 */
import { useState, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import {
  Settings, Info, Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Check, X, GripVertical, AlertCircle, EyeOff, Eye, Receipt,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { MERCHANT_ADDRESS } from '@/lib/merchant'
import { ARC_TESTNET_CHAIN_ID } from '@/onchain-facts'
import { CONTRACT_ADDRESS, ARC_TESTNET_ID } from '@/lib/contract'
import { parseUsdc } from '@/onchain-money'

// ── Types (re-declared here to avoid cross-file coupling) ─────────────────────

export interface MenuItem {
  id: string
  name: string
  price: string      // human USDC string e.g. "2.50"
  emoji: string
  imageUrl?: string  // optional URL to an item photo
  unavailable?: boolean
}

// ── Business profile ──────────────────────────────────────────────────────────

export interface BusinessProfile {
  name: string
  logoUrl: string
}

function profileKey(account: string): string {
  return `arc-receipt:profile:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}

export function loadProfile(account: string): BusinessProfile {
  try {
    const raw = localStorage.getItem(profileKey(account))
    if (!raw) return { name: '', logoUrl: '' }
    const p = JSON.parse(raw) as Partial<BusinessProfile>
    return {
      name: typeof p.name === 'string' ? p.name.trim() : '',
      logoUrl: typeof p.logoUrl === 'string' ? p.logoUrl.trim() : '',
    }
  } catch { return { name: '', logoUrl: '' } }
}

export function saveProfile(account: string, profile: BusinessProfile): void {
  try { localStorage.setItem(profileKey(account), JSON.stringify(profile)) } catch { /**/ }
}

// ── Storage helpers (same keys as SellPage) ───────────────────────────────────

function menuKey(account: string): string {
  return `arc-receipt:menu:${ARC_TESTNET_ID}:${CONTRACT_ADDRESS}:${account.toLowerCase()}`
}

const DEFAULT_MENU: MenuItem[] = [
  { id: 'burger', name: 'Burger',  price: '2',   emoji: '🍔' },
  { id: 'coke',   name: 'Coke',    price: '3',   emoji: '🥤' },
  { id: 'fries',  name: 'Fries',   price: '1',   emoji: '🍟' },
  { id: 'coffee', name: 'Coffee',  price: '2',   emoji: '☕' },
]

const DEFAULT_IDS = new Set(DEFAULT_MENU.map(m => m.id))

function isValidMenuPrice(price: unknown): boolean {
  if (typeof price !== 'string') return false
  if (!/^\d+(\.\d{1,6})?$/.test(price.trim())) return false
  try {
    const raw = parseUsdc(price.trim())
    return raw > 0n
  } catch { return false }
}

function sanitizeMenuItem(item: unknown): MenuItem | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id.trim()) return null
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  if (!isValidMenuPrice(o.price)) return null
  return {
    id: o.id,
    name: o.name,
    price: String(o.price).trim(),
    emoji: typeof o.emoji === 'string' ? o.emoji : '🍽',
    imageUrl: typeof o.imageUrl === 'string' && o.imageUrl.trim() ? o.imageUrl.trim() : undefined,
    unavailable: typeof o.unavailable === 'boolean' ? o.unavailable : false,
  }
}

function loadMenu(account: string): MenuItem[] {
  try {
    // localStorage for durable menu — survives browser restarts.
    const raw = localStorage.getItem(menuKey(account))
    if (!raw) return DEFAULT_MENU
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return DEFAULT_MENU
    const valid = parsed.map(sanitizeMenuItem).filter((x): x is MenuItem => x !== null)
    return valid.length > 0 ? valid : DEFAULT_MENU
  } catch { return DEFAULT_MENU }
}

function saveMenu(account: string, menu: MenuItem[]): void {
  try { localStorage.setItem(menuKey(account), JSON.stringify(menu)) } catch { /* ignore */ }
}

// ── MenuRow — single editable row ─────────────────────────────────────────────

function MenuRow({
  item, isFirst, isLast, onMoveUp, onMoveDown, onEdit, onDelete, onToggleAvailable,
}: {
  item: MenuItem
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleAvailable: () => void
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-3 border-b border-slate-50 last:border-0 ${item.unavailable ? 'opacity-50' : ''}`}>
      {/* Drag handle (visual only) */}
      <GripVertical size={14} className="text-slate-300 shrink-0 cursor-grab" />

      {/* Image or emoji */}
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.name}
          className="w-9 h-9 rounded-lg object-cover shrink-0 border border-slate-100"
          onError={e => { (e.currentTarget).style.display = 'none' }}
        />
      ) : (
        <span className="text-xl w-9 text-center shrink-0">{item.emoji}</span>
      )}

      {/* Name + price */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">
          {item.name}
          {DEFAULT_IDS.has(item.id) && (
            <span className="ml-1.5 text-xs text-slate-400 font-normal">(sample)</span>
          )}
        </p>
        <p className="text-xs text-slate-500 flex items-center gap-0.5">
          <TokenUSDC variant="branded" size={11} />{item.price} USDC
        </p>
      </div>

      {/* Reorder */}
      <div className="flex flex-col gap-0.5">
        <button onClick={onMoveUp} disabled={isFirst}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors" title="Move up">
          <ChevronUp size={12} className="text-slate-500" />
        </button>
        <button onClick={onMoveDown} disabled={isLast}
          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors" title="Move down">
          <ChevronDown size={12} className="text-slate-500" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button onClick={onToggleAvailable}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          title={item.unavailable ? 'Mark available' : 'Mark unavailable'}>
          {item.unavailable ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
          title="Edit">
          <Pencil size={13} />
        </button>
        <button onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors"
          title="Remove">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ── EditForm — inline add/edit form ───────────────────────────────────────────

function EditForm({
  initial, onSave, onCancel, isNew,
}: {
  initial: Partial<MenuItem>
  onSave: (item: Omit<MenuItem, 'id'>) => void
  onCancel: () => void
  isNew: boolean
}) {
  const [name,     setName]     = useState(initial.name ?? '')
  const [price,    setPrice]    = useState(initial.price ?? '')
  const [emoji,    setEmoji]    = useState(initial.emoji ?? '🍽')
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? '')
  const [imgOk,    setImgOk]    = useState(!!initial.imageUrl)

  const handleSave = useCallback(() => {
    if (!name.trim()) { toast.error('Name is required'); return }
    try {
      const raw = parseUsdc(price.trim())
      if (raw <= 0n) { toast.error('Price must be greater than zero'); return }
    } catch { toast.error('Invalid price — enter a positive decimal number'); return }
    onSave({
      name: name.trim(),
      price: price.trim(),
      emoji: emoji || '🍽',
      imageUrl: imageUrl.trim() || undefined,
    })
  }, [name, price, emoji, imageUrl, onSave])

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-emerald-800">{isNew ? 'Add item' : 'Edit item'}</p>

      {/* Name row with emoji/image preview */}
      <div className="flex gap-2 items-center">
        {/* Preview: shows image if URL is valid, else emoji input */}
        {imageUrl && imgOk ? (
          <img
            src={imageUrl}
            alt="preview"
            className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
            onError={() => setImgOk(false)}
          />
        ) : (
          <input
            value={emoji} onChange={e => setEmoji(e.target.value)}
            className="w-11 text-center rounded-lg border border-slate-200 bg-white py-2 text-base focus:outline-none focus:ring-2 focus:ring-emerald-400 shrink-0"
            maxLength={2} placeholder="🍽" aria-label="Emoji"
          />
        )}
        <input
          value={name} onChange={e => setName(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          placeholder="Item name" aria-label="Item name"
        />
      </div>

      {/* Image URL */}
      <div>
        <input
          value={imageUrl}
          onChange={e => { setImageUrl(e.target.value); setImgOk(true) }}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
          placeholder="Photo URL (optional) — e.g. https://…/burger.jpg"
          aria-label="Item photo URL"
        />
        <p className="text-xs text-slate-400 mt-1">Paste any image URL. Leave empty to use emoji.</p>
      </div>

      {/* Price */}
      <div className="flex items-center gap-2">
        <TokenUSDC variant="branded" size={14} />
        <input
          type="number" min="0" step="0.01"
          value={price} onChange={e => setPrice(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          placeholder="0.00 USDC" aria-label="Price in USDC"
        />
      </div>

      <div className="flex gap-2">
        <button onClick={handleSave}
          className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
          <Check size={12} /> {isNew ? 'Add' : 'Save'}
        </button>
        <button onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center gap-1 transition-colors">
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main settings page ────────────────────────────────────────────────────────

export default function MerchantSettingsPage() {
  const { address } = useAccount()

  // Track the address we last loaded for — reload when it changes.
  const [loadedFor, setLoadedFor] = useState<string | undefined>(address)
  const [menu, setMenu] = useState<MenuItem[]>(() =>
    address ? loadMenu(address) : DEFAULT_MENU
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)

  // Business profile
  const [profile, setProfile] = useState<BusinessProfile>(() =>
    address ? loadProfile(address) : { name: '', logoUrl: '' }
  )
  const [profileName,    setProfileName]    = useState(() => address ? loadProfile(address).name : '')
  const [profileLogoUrl, setProfileLogoUrl] = useState(() => address ? loadProfile(address).logoUrl : '')
  const [logoPreviewOk,  setLogoPreviewOk]  = useState(true)

  // When the connected wallet changes, reload the menu for the new address.
  // This is an intentional synchronisation with sessionStorage (an external
  // system), so setState-in-effect is the correct pattern here.
  if (address !== loadedFor) {
    setLoadedFor(address)
    setMenu(address ? loadMenu(address) : DEFAULT_MENU)
    setEditingId(null)
    setAddingNew(false)
    const p = address ? loadProfile(address) : { name: '', logoUrl: '' }
    setProfile(p)
    setProfileName(p.name)
    setProfileLogoUrl(p.logoUrl)
    setLogoPreviewOk(true)
  }

  // Persist whenever menu changes
  useEffect(() => {
    if (address) saveMenu(address, menu)
  }, [menu, address])

  const handleAdd = useCallback((item: Omit<MenuItem, 'id'>) => {
    const id = `custom-${Date.now()}`
    setMenu(prev => [...prev, { ...item, id, unavailable: false }])
    setAddingNew(false)
    toast.success(`"${item.name}" added`)
  }, [])

  const handleEdit = useCallback((id: string, item: Omit<MenuItem, 'id'>) => {
    setMenu(prev => prev.map(m => m.id === id ? { ...m, ...item } : m))
    setEditingId(null)
    toast.success('Item updated')
  }, [])

  const handleDelete = useCallback((id: string, name: string) => {
    setMenu(prev => prev.filter(m => m.id !== id))
    toast.success(`"${name}" removed`)
  }, [])

  const handleToggleAvailable = useCallback((id: string) => {
    setMenu(prev => prev.map(m => m.id === id ? { ...m, unavailable: !m.unavailable } : m))
  }, [])

  const handleMoveUp = useCallback((idx: number) => {
    if (idx === 0) return
    setMenu(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }, [])

  const handleMoveDown = useCallback((idx: number) => {
    setMenu(prev => {
      if (idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }, [])

  const handleReset = useCallback(() => {
    setMenu(DEFAULT_MENU)
    setEditingId(null)
    setAddingNew(false)
    toast.success('Menu reset to defaults')
  }, [])

  const handleSaveProfile = useCallback(() => {
    if (!address) return
    const p: BusinessProfile = { name: profileName.trim(), logoUrl: profileLogoUrl.trim() }
    saveProfile(address, p)
    setProfile(p)
    toast.success('Business profile saved')
  }, [address, profileName, profileLogoUrl])

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Settings
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Workspace configuration and menu presets</p>
      </div>

      {/* Business profile */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
            {profile.logoUrl && logoPreviewOk ? (
              <img
                src={profile.logoUrl}
                alt={profile.name || 'Logo'}
                className="w-full h-full object-cover"
                onError={() => setLogoPreviewOk(false)}
              />
            ) : (
              <Receipt size={14} className="text-slate-400" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {profile.name || 'Business profile'}
            </p>
            <p className="text-xs text-slate-400">Shown in the merchant header</p>
          </div>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Business name</label>
            <input
              value={profileName}
              onChange={e => setProfileName(e.target.value)}
              placeholder="e.g. Sharath's Café"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Logo URL</label>
            <div className="flex gap-2 items-center">
              {profileLogoUrl && logoPreviewOk && (
                <img
                  src={profileLogoUrl}
                  alt="logo preview"
                  className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                  onError={() => setLogoPreviewOk(false)}
                />
              )}
              <input
                value={profileLogoUrl}
                onChange={e => { setProfileLogoUrl(e.target.value); setLogoPreviewOk(true) }}
                placeholder="https://…/logo.png"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">Paste any image URL. Leave empty to use the default icon.</p>
          </div>
          <button
            onClick={handleSaveProfile}
            className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            <Check size={14} /> Save profile
          </button>
        </div>
      </div>

      {/* Deployment info */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Info size={15} className="text-slate-400" />
          <p className="text-sm font-semibold text-slate-800">Deployment</p>
        </div>
        <div className="space-y-1.5 text-xs text-slate-600">
          <InfoRow label="Chain" value={`Arc Testnet (${ARC_TESTNET_CHAIN_ID})`} />
          <InfoRow label="Contract" value={CONTRACT_ADDRESS} mono />
          <InfoRow label="Merchant wallet" value={MERCHANT_ADDRESS ?? 'Not configured'} mono={!!MERCHANT_ADDRESS} />
        </div>
      </div>

      {/* Menu preset management */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-slate-400" />
            <p className="text-sm font-semibold text-slate-800">Menu presets</p>
            <span className="text-xs text-slate-400">({menu.length} items)</span>
          </div>
          <button
            onClick={() => { setAddingNew(true); setEditingId(null) }}
            disabled={addingNew}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40 transition-colors"
          >
            <Plus size={13} /> Add item
          </button>
        </div>

        {/* Disclaimer */}
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-start gap-2 text-xs text-amber-700">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span>
            Prices marked <strong>(sample)</strong> are demonstration values — not representative of any real business.
            Changes here update the Sell screen only. Existing cart items and submitted orders are not affected.
          </span>
        </div>

        {/* Add form */}
        {addingNew && (
          <div className="px-3 py-3 border-b border-slate-100">
            <EditForm
              initial={{}}
              onSave={handleAdd}
              onCancel={() => setAddingNew(false)}
              isNew
            />
          </div>
        )}

        {/* Menu list */}
        {menu.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-400">No items yet. Add one above.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {menu.map((item, idx) => (
              <div key={item.id}>
                {editingId === item.id ? (
                  <div className="px-3 py-3">
                    <EditForm
                      initial={item}
                      onSave={(updated) => handleEdit(item.id, updated)}
                      onCancel={() => setEditingId(null)}
                      isNew={false}
                    />
                  </div>
                ) : (
                  <MenuRow
                    item={item}
                    isFirst={idx === 0}
                    isLast={idx === menu.length - 1}
                    onMoveUp={() => handleMoveUp(idx)}
                    onMoveDown={() => handleMoveDown(idx)}
                    onEdit={() => { setEditingId(item.id); setAddingNew(false) }}
                    onDelete={() => handleDelete(item.id, item.name)}
                    onToggleAvailable={() => handleToggleAvailable(item.id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Reset to defaults */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
          <button onClick={handleReset}
            className="text-xs text-slate-400 hover:text-rose-500 transition-colors">
            Reset to sample menu
          </button>
          <p className="text-xs text-slate-400 mt-1">
            Menu items are stored in this browser's local storage, scoped to this merchant wallet and contract.
            They survive browser restarts but are not synced across devices or browsers.
          </p>
        </div>
      </div>

      {/* Availability legend */}
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1 text-xs text-slate-500">
        <p className="font-medium text-slate-600">Availability</p>
        <p>
          Mark an item unavailable to hide it from the Sell screen temporarily.
          It stays in your menu and can be re-enabled here.
        </p>
        <p className="text-slate-400">
          Availability is a local setting — not stored onchain. It resets if you clear browser storage.
        </p>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
