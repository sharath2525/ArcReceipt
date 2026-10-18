/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { fallback } from 'viem'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Arc Testnet RPCs — 4 independent providers as fallbacks.
// viem/chains arcTestnet ships these in order:
//   [0] rpc.testnet.arc.io          (Arc primary)
//   [1] rpc.blockdaemon.testnet.arc.io
//   [2] rpc.drpc.testnet.arc.io
//   [3] rpc.quicknode.testnet.arc.io
// No auth required; no secret exposed in browser code.
const arcRpcs = arcTestnet.rpcUrls.default.http // string[]

registerChain(arcTestnet.id, arcRpcs[0])

export const arcTestnetChain = arcTestnet

// Per-provider options: 10 s timeout, 1 retry per provider.
// viem's fallback transport tries each provider in order; a generous timeout
// avoids false positives from slow but reachable endpoints (Vercel's shared
// egress IPs can see higher latency to some RPC providers under load).
// 1 retry-per-provider catches transient TCP resets before falling over.
const rpcOpts = { timeout: 10_000, retryCount: 1, retryDelay: 500 } as const

export const config = createConfig({
  chains: [arcTestnet, mainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    // rank=1 → tries all 4 providers before giving up; rank=0 (default) would
    // stop at the first success and not retry on intermittent errors.
    [arcTestnet.id]: fallback(arcRpcs.map(url => http(url, rpcOpts)), { rank: false }),
    [mainnet.id]: http(), // ENS resolution only
  },
})
