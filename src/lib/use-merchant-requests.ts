/**
 * use-merchant-requests.ts — Paginated merchant request IDs and live statuses.
 *
 * STAGE 2 IMPROVEMENTS:
 *
 * S2-G — Consistent reference block.
 *   Reads the current block number once, then uses `blockTag` on all
 *   getMerchantRequests page calls and getRequest status calls so that
 *   all reads reflect a single point in time. A new request created while
 *   reading page 2 cannot corrupt the count.
 *   Falls back gracefully: if blockTag reads fail, returns partial results
 *   with `isPartial=true` and `failedStatusCount` incremented.
 *
 * S2-H — Merchant validation on every getRequest result.
 *   `req.merchant` is compared (case-insensitive) against the queried
 *   merchant address before inserting into requestMap. A corrupted RPC
 *   response returning another merchant's data is silently discarded.
 *
 * S2-I — Stale-time tuning.
 *   Total/page queries: staleTime:0, refetchInterval:15_000 (was 30s).
 *   Status queries: staleTime:5_000, refetchInterval:15_000 (was 30s).
 *   Today dashboard needs fresh data; the 30s cycle was too slow.
 *
 * Spec §1: contract-first fast summary. For collections and payment counts
 *   the caller should use requestMap (req.status===1 + req.paidAt) rather
 *   than waiting for the event scan. This hook exposes everything needed.
 */

import { useMemo, useCallback, useState, useEffect } from 'react'
import { useReadContract, useReadContracts, usePublicClient } from 'wagmi'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID, type OnchainRequest,
} from '@/lib/contract'

const PAGE_SIZE = 20n

/**
 * Fetches ALL request IDs for the given merchant via paginated
 * getMerchantRequests calls, then reads live status for each at a
 * consistent reference block.
 */
export function useMerchantAllRequests(merchant: `0x${string}` | null) {
  const publicClient = usePublicClient({ chainId: ARC_TESTNET_ID })

  // S2-G: Reference block — state is updated only from async callbacks,
  // never synchronously inside the effect body, so no cascading-render lint
  // warning. `undefined` means "use latest block" (wagmi default).
  const [refBlock, setRefBlock] = useState<bigint | undefined>(undefined)

  useEffect(() => {
    if (!merchant || !publicClient) return
    let cancelled = false
    const fetchBlock = () => {
      void publicClient.getBlockNumber().then(bn => {
        if (!cancelled) setRefBlock(bn)
      }).catch(() => {/* keep existing value */})
    }
    fetchBlock()
    const id = setInterval(fetchBlock, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [merchant, publicClient])

  // Step 1: total count (limit=0 returns just the total)
  const { data: totalData, error: totalError, isLoading: loadingTotal, refetch: refetchTotal } =
    useReadContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests',
      args: merchant ? [merchant, 0n, 0n] : undefined,
      chainId: ARC_TESTNET_ID,
      // Use refblock when available; fall back to latest
      ...(refBlock !== undefined ? { blockNumber: refBlock } : {}),
      query: { enabled: !!merchant, staleTime: 0, refetchInterval: 15_000 },
    })

  const total: bigint = totalData ? (totalData as [bigint[], bigint])[1] : 0n
  const pageCount = total > 0n ? Number((total + PAGE_SIZE - 1n) / PAGE_SIZE) : 0

  // Step 2: paginated ID reads at the same reference block
  const pageContracts = useMemo(() => {
    if (!merchant || pageCount === 0) return []
    return Array.from({ length: pageCount }, (_, i) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests' as const,
      args: [merchant, BigInt(i) * PAGE_SIZE, PAGE_SIZE] as [`0x${string}`, bigint, bigint],
      chainId: ARC_TESTNET_ID,
      // S2-G: pin to same block
      ...(refBlock !== undefined ? { blockNumber: refBlock } : {}),
    }))
  }, [merchant, pageCount, refBlock])

  const { data: pagesData, isLoading: loadingPages, error: pagesError, refetch: refetchPages } =
    useReadContracts({
      contracts: pageContracts,
      query: {
        enabled: pageContracts.length > 0,
        staleTime: 0,
        refetchInterval: 15_000,
      },
    })

  // All IDs, newest first
  const allIds = useMemo(() => {
    if (!pagesData) return [] as bigint[]
    const ids: bigint[] = []
    for (const page of pagesData) {
      if (page.status === 'success') {
        const [pageIds] = page.result as [bigint[], bigint]
        ids.push(...pageIds)
      }
    }
    return ids.slice().sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
  }, [pagesData])

  // Step 3: status reads, also at the reference block
  const statusContracts = useMemo(
    () => allIds.map(id => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getRequest' as const,
      args: [id] as [bigint],
      chainId: ARC_TESTNET_ID,
      ...(refBlock !== undefined ? { blockNumber: refBlock } : {}),
    })),
    [allIds, refBlock]
  )

  const { data: statusData, isLoading: loadingStatus, refetch: refetchStatus } =
    useReadContracts({
      contracts: statusContracts,
      query: {
        enabled: statusContracts.length > 0,
        staleTime: 5_000,
        refetchInterval: 15_000,
      },
    })

  // S2-H: Validate merchant field before inserting into requestMap
  const requestMap = useMemo(() => {
    const map = new Map<string, OnchainRequest>()
    if (!statusData || !merchant) return map
    statusData.forEach((item, i) => {
      if (item.status === 'success' && item.result) {
        const req = item.result as OnchainRequest
        // S2-H: reject zero-address (not found) and wrong-merchant responses
        if (req.merchant === '0x0000000000000000000000000000000000000000') return
        if (req.merchant.toLowerCase() !== merchant.toLowerCase()) return
        map.set(allIds[i].toString(), req)
      }
    })
    return map
  }, [statusData, allIds, merchant])

  const isLoading = loadingTotal || (pageCount > 0 && loadingPages) || (allIds.length > 0 && loadingStatus)
  const error = totalError ?? pagesError ?? null

  const refetch = useCallback(async () => {
    // Refresh reference block on explicit refetch
    if (publicClient) {
      try {
        const bn = await publicClient.getBlockNumber()
        setRefBlock(bn)
      } catch { /* keep old */ }
    }
    await refetchTotal()
    await refetchPages()
    await refetchStatus()
  }, [refetchTotal, refetchPages, refetchStatus, publicClient])

  const failedStatusCount = useMemo(() => {
    if (!statusData) return 0
    return statusData.filter(item => item.status === 'failure').length
  }, [statusData])

  // Number of page reads that failed (partial ID list)
  const failedPageCount = useMemo(() => {
    if (!pagesData) return 0
    return pagesData.filter(p => p.status === 'failure').length
  }, [pagesData])

  return {
    allIds,
    total,
    requestMap,
    isLoading,
    error,
    refetch,
    failedStatusCount,
    failedPageCount,
    /** True when some ID pages failed to load — totals derived from requestMap may be incomplete. */
    isPartial: failedPageCount > 0 || failedStatusCount > 0,
  }
}
