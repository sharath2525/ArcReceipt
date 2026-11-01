/**
 * wagmi configuration
 *
 * Network is controlled entirely by env vars — no code changes to switch
 * between Arc Testnet and Arc Mainnet.
 *
 *   VITE_CHAIN_ID   5042002 = Arc Testnet (default)
 *                   5042    = Arc Mainnet
 *   VITE_RPC_URL    Optional single primary RPC override. When unset the
 *                   viem/chains default RPC list is used (4 providers).
 *
 * RPC timeout policy:
 *   timeout: 5_000, retryCount: 0 per transport
 *   fallback retryCount: 0
 *   → worst-case wait before failure: 4 × 5 s = 20 s
 *   → Previous setting (timeout 20 s, retryCount 2): worst case ~82 s
 *   → After 20 s the query fails and the UI shows Retry instead of
 *     an infinite spinner.
 */

import { http, createConfig } from 'wagmi'
import { fallback } from 'viem'
import { mainnet, arcTestnet, arc } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { CHAIN_ID } from './lib/contract'

// ── RPC URL list for the active chain ─────────────────────────────────────────

function buildRpcList(): string[] {
  // Optional single override from env (useful for mainnet custom node)
  const override = (import.meta.env.VITE_RPC_URL as string | undefined)?.trim()
  if (override) return [override]

  if (CHAIN_ID === 5042) {
    // Arc Mainnet — primary public endpoint
    return ['https://rpc.mainnet.arc.io']
  }
  // Arc Testnet — 4 independent providers from viem/chains
  return arcTestnet.rpcUrls.default.http as unknown as string[]
}

const rpcList = buildRpcList()

// Register primary RPC for trace panel
registerChain(CHAIN_ID, rpcList[0])

// Per-provider: 5 s timeout, no internal retries.
// fallback() moves to the next provider immediately on timeout/error.
const rpcOpts = { timeout: 5_000, retryCount: 0 } as const

// Build the active chain transport
const activeTransport = fallback(
  rpcList.map(url => http(url, rpcOpts)),
  { retryCount: 0 },
)

// Determine the active viem chain object
const activeChain = CHAIN_ID === 5042 ? arc : arcTestnet

export const arcTestnetChain = activeChain

// wagmi createConfig requires a transport for every declared chain ID at
// compile time. We declare both Arc Testnet (5042002) and Arc Mainnet (5042)
// even though only one is the active chain — the inactive one gets a no-op
// http() transport that is never called. This satisfies the type constraint
// while keeping the env-var-driven active transport in the right slot.
export const config = createConfig({
  // Include both Arc chains so the transport map has no missing keys.
  // The active chain is first so ConnectKit shows it as the default.
  chains: [activeChain, activeChain.id === arc.id ? arcTestnet : arc, mainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [arcTestnet.id]: CHAIN_ID === arcTestnet.id ? activeTransport : http(),
    [arc.id]:        CHAIN_ID === arc.id        ? activeTransport : http(),
    [mainnet.id]:    http(), // ENS resolution only
  },
})
