/**
 * ArcReceiptCheckout — single source of truth for contract constants.
 *
 * Topic-0 hashes are DERIVED from the ABI at module load time using viem's
 * keccak256, not hand-copied strings. This means they can never drift from
 * the deployed contract ABI. The canonical ABI is the compiled artifact at
 * contracts/out/ArcReceiptCheckout.sol/ArcReceiptCheckout.json.
 *
 * Chain: Arc Testnet (chainId 5042002)
 * Deployed: 2026-10-16T07:21:04.299Z
 * Deploy TX: 0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45
 * Source SHA-256: 87b9c9a410ba3581358561f00ac25879d89b1f33501d03171dd6d6829d0f064b
 * forge-std: 1.16.2 (lib/forge-std/package.json)
 */

import { keccak256, toHex, type Abi, type AbiEvent } from 'viem'
import artifact from '../../contracts/out/ArcReceiptCheckout.sol/ArcReceiptCheckout.json'

export const ARC_TESTNET_ID = 5042002

export const CONTRACT_ADDRESS =
  '0x4017d948c7a8f370f5e8d0eee6da7be2859bea18' as const

export const CONTRACT_ABI = artifact.abi as Abi

// ── Topic-0 derivation from ABI ───────────────────────────────────────────────
// Signature strings are constructed from the ABI, then hashed with keccak256.
// If the ABI changes, these values update automatically.

function abiEventSig(name: string, types: string[]): string {
  return `${name}(${types.join(',')})`
}

function topic0(sig: string): `0x${string}` {
  return keccak256(toHex(sig))
}

// Locate events by name from the artifact ABI for type-safety
function findEvent(name: string): AbiEvent {
  const ev = (artifact.abi as Abi).find(
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

/**
 * keccak256("RequestCreated(uint256,address,uint256,uint256)")
 * Derived from artifact ABI at module load time.
 * topics[1]=id (indexed), topics[2]=merchant (indexed)
 */
export const REQUEST_CREATED_TOPIC: `0x${string}` = eventTopic0('RequestCreated')

/**
 * keccak256("PaymentRecorded(uint256,address,address,uint256,uint256)")
 * Derived from artifact ABI at module load time.
 * topics[1]=id (indexed), topics[2]=merchant (indexed), topics[3]=payer (indexed)
 */
export const PAYMENT_RECORDED_TOPIC: `0x${string}` = eventTopic0('PaymentRecorded')

// Status enum mirroring Solidity enum RequestStatus { Open, Paid, Cancelled }
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

/** Extract the request ID from a CreateRequest receipt log.
 *  Handles wagmi v2 Log objects where topics are `readonly (Hex | null)[]`.
 *  Comparison is lowercase to avoid 0x/0X casing mismatches. */
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

/**
 * The public base URL for shareable links.
 * Reads VITE_APP_ORIGIN at build time (set in .env for public deployments).
 * Falls back to window.location.origin — which in Studio preview is the
 * restricted preview URL, so always set VITE_APP_ORIGIN before deploying.
 */
function publicOrigin(): string {
  const env = import.meta.env.VITE_APP_ORIGIN as string | undefined
  if (env && env.trim()) return env.trim().replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/** Build a shareable payment link for a given request ID. */
export function buildPaymentLink(id: bigint | number | string): string {
  return `${publicOrigin()}?request=${id}`
}

/** Build a receipt/verify link. */
export function buildReceiptLink(id: bigint | number | string): string {
  return `${publicOrigin()}?request=${id}&view=receipt`
}
