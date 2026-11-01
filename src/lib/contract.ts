/**
 * ArcReceiptCheckout — single source of truth for contract constants.
 *
 * ALL network-specific values are read from Vite env vars so switching
 * testnet ↔ mainnet requires ONLY a Vercel environment variable change —
 * zero code edits. Set these vars in your Vercel project settings:
 *
 *   VITE_CHAIN_ID          Chain ID as a decimal integer (e.g. 5042002 or 5042)
 *   VITE_CONTRACT_ADDRESS  Deployed ArcReceiptCheckout address (0x…)
 *   VITE_USDC_ADDRESS      USDC ERC-20 address for this chain (0x…)
 *   VITE_EXPLORER_BASE     Block explorer base URL (no trailing slash)
 *   VITE_RPC_URL           Primary JSON-RPC endpoint (optional override)
 *   VITE_APP_ORIGIN        Public base URL for shareable links
 *
 * Testnet defaults are baked in so the app works in Studio preview and local
 * dev without any env file. All defaults are Arc Testnet (5042002).
 *
 * Topic-0 hashes are DERIVED from the ABI at module load time using viem's
 * keccak256 so they can never drift from the deployed contract ABI.
 */

import { keccak256, toHex, type Abi, type AbiEvent } from 'viem'

// ABI inlined so Vercel can build without Foundry installed.
// Source: contracts/ArcReceiptCheckout.sol (compiled with forge build).
// Do not edit manually — regenerate with: forge build && update from
// contracts/out/ArcReceiptCheckout.sol/ArcReceiptCheckout.json
const ABI_JSON = [{"type":"constructor","inputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"USDC","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"cancelRequest","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"createRequest","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"expiresAt","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"getMerchantRequests","inputs":[{"name":"merchant","type":"address","internalType":"address"},{"name":"offset","type":"uint256","internalType":"uint256"},{"name":"limit","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"ids","type":"uint256[]","internalType":"uint256[]"},{"name":"total","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"getRequest","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"tuple","internalType":"struct ArcReceiptCheckout.Request","components":[{"name":"merchant","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"expiresAt","type":"uint256","internalType":"uint256"},{"name":"status","type":"uint8","internalType":"enum ArcReceiptCheckout.RequestStatus"},{"name":"payer","type":"address","internalType":"address"},{"name":"paidAt","type":"uint256","internalType":"uint256"}]}],"stateMutability":"view"},{"type":"function","name":"pay","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"requests","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"merchant","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"expiresAt","type":"uint256","internalType":"uint256"},{"name":"status","type":"uint8","internalType":"enum ArcReceiptCheckout.RequestStatus"},{"name":"payer","type":"address","internalType":"address"},{"name":"paidAt","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"event","name":"PaymentRecorded","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"merchant","type":"address","indexed":true,"internalType":"address"},{"name":"payer","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"paidAt","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"RequestCancelled","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"merchant","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RequestCreated","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"merchant","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"expiresAt","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"ExpiryMustBeFuture","inputs":[]},{"type":"error","name":"ExpiryTooFar","inputs":[]},{"type":"error","name":"NotMerchant","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"RequestExpired","inputs":[]},{"type":"error","name":"RequestNotFound","inputs":[]},{"type":"error","name":"RequestNotOpen","inputs":[]},{"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},{"type":"error","name":"SelfPayment","inputs":[]},{"type":"error","name":"ZeroAmount","inputs":[]}] as const

// ── Env-var readers with testnet defaults ─────────────────────────────────────

function envStr(key: string, fallback: string): string {
  const v = (import.meta.env as Record<string, string | undefined>)[key]
  return v && v.trim() ? v.trim() : fallback
}

function envInt(key: string, fallback: number): number {
  const v = (import.meta.env as Record<string, string | undefined>)[key]
  if (!v || !v.trim()) return fallback
  const n = parseInt(v.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// ── Network constants — read from env, fall back to Arc Testnet ───────────────

/** Chain ID — set VITE_CHAIN_ID=5042 for mainnet, leave unset for testnet. */
export const CHAIN_ID: number = envInt('VITE_CHAIN_ID', 5042002)

/** Backward-compat alias used throughout the codebase. */
export const ARC_TESTNET_ID: number = CHAIN_ID

/** Deployed contract address for this chain. */
export const CONTRACT_ADDRESS = envStr(
  'VITE_CONTRACT_ADDRESS',
  '0x4017d948c7a8f370f5e8d0eee6da7be2859bea18',
) as `0x${string}`

/** USDC ERC-20 address for this chain.
 *  Arc Testnet + Arc Mainnet both use 0x3600…0000.
 *  Other chains have different USDC addresses — set VITE_USDC_ADDRESS. */
export const USDC_ADDRESS = envStr(
  'VITE_USDC_ADDRESS',
  '0x3600000000000000000000000000000000000000',
) as `0x${string}`

/** Block explorer base URL (no trailing slash). */
export const EXPLORER_BASE = envStr(
  'VITE_EXPLORER_BASE',
  'https://explorer.testnet.arc.io',
)

/** Network display label — shown in the testnet/mainnet banner. */
export const NETWORK_LABEL: string = (() => {
  const id = CHAIN_ID
  if (id === 5042)    return 'Arc Mainnet'
  if (id === 5042002) return 'Arc Testnet'
  return `Chain ${id}`
})()

/** Whether this is a testnet (show warning banner). */
export const IS_TESTNET: boolean = CHAIN_ID !== 5042

// ── ABI ───────────────────────────────────────────────────────────────────────

export const CONTRACT_ABI = ABI_JSON as Abi

// ── Topic-0 derivation from ABI ───────────────────────────────────────────────

function abiEventSig(name: string, types: string[]): string {
  return `${name}(${types.join(',')})`
}

function topic0(sig: string): `0x${string}` {
  return keccak256(toHex(sig))
}

function findEvent(name: string): AbiEvent {
  const ev = (ABI_JSON as Abi).find(
    (x): x is AbiEvent => x.type === 'event' && x.name === name
  )
  if (!ev) throw new Error(`Event ${name} not found in ABI`)
  return ev
}

function eventTopic0(name: string): `0x${string}` {
  const ev = findEvent(name)
  const types = ev.inputs.map((i) => i.type)
  return topic0(abiEventSig(name, types))
}

export const REQUEST_CREATED_TOPIC: `0x${string}` = eventTopic0('RequestCreated')
export const PAYMENT_RECORDED_TOPIC: `0x${string}` = eventTopic0('PaymentRecorded')

// Status enum
export const STATUS_OPEN = 0
export const STATUS_PAID = 1
export const STATUS_CANCELLED = 2

export interface OnchainRequest {
  merchant: `0x${string}`
  amount: bigint
  expiresAt: bigint
  status: 0 | 1 | 2
  payer: `0x${string}`
  paidAt: bigint
}

/** Extract the request ID from a CreateRequest receipt log. */
export function extractIdFromReceipt(
  receipt: { logs: Array<{ address: string; topics: readonly (string | null)[] }> }
): bigint | null {
  const wantTopic = REQUEST_CREATED_TOPIC.toLowerCase()
  const log = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase() &&
      typeof l.topics[0] === 'string' &&
      l.topics[0].toLowerCase() === wantTopic
  )
  const idTopic = log?.topics[1]
  return idTopic ? BigInt(idTopic) : null
}

/** Build a block-explorer TX link. */
export function buildTxExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`
}

/** Build a block-explorer address link. */
export function buildAddressExplorerUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`
}

/** Public base URL for shareable links. */
function publicOrigin(): string {
  const env = import.meta.env.VITE_APP_ORIGIN as string | undefined
  if (env && env.trim()) return env.trim().replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function buildPaymentLink(id: bigint | number | string): string {
  return `${publicOrigin()}/pay/${id}`
}

export function buildReceiptLink(id: bigint | number | string): string {
  return `${publicOrigin()}/receipt/${id}`
}
