/**
 * use-merchant-requests.ts — Paginated merchant request IDs and live statuses.
 *
 * A5 (Part 1): "Awaiting payment" must include ALL open requests, not just
 * those in the recent event-scan window. This hook uses getMerchantRequests
 * pagination (the contract-native source) to enumerate every request ID the
 * configured merchant has ever created, then reads their live status.
 *
 * Exported as a shared hook used by MerchantTodayPage and MerchantDashboard.
 * MerchantDashboard has its own inline copy (usePaginatedIds) which is kept
 * for backward compatibility; this module provides the version used for
 * awaiting-payment counts on Today/Reports.
 */

import { useMemo, useCallback } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import {
  CONTRACT_ADDRESS, CONTRACT_ABI, ARC_TESTNET_ID, type OnchainRequest,
} from '@/lib/contract'

const PAGE_SIZE = 20n

/**
 * Fetches ALL request IDs for the given merchant via paginated
 * getMerchantRequests calls, then reads live status for each.
 *
 * Returns:
 *   allIds — every request ID (descending order, newest first)
 *   total  — contract-reported total count
 *   requestMap — Map<string, OnchainRequest> for live status lookups
 *   isLoading — true while any page is in flight
 *   error — first error encountered, or null
 *   refetch — re-read all pages
 *
 * Uses staleTime:0 + refetchInterval:30_000 so the Today dashboard
 * refreshes without hammering the RPC on every tab focus.
 */
export function useMerchantAllRequests(merchant: `0x${string}` | null) {
  const { data: totalData, error: totalError, isLoading: loadingTotal, refetch: refetchTotal } =
    useReadContract({
      address: CONTRACT_ADDRESS, abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests',
      args: merchant ? [merchant, 0n, 0n] : undefined,
      chainId: ARC_TESTNET_ID,
      query: { enabled: !!merchant, staleTime: 0, refetchInterval: 30_000 },
    })

  const total: bigint = totalData ? (totalData as [bigint[], bigint])[1] : 0n
  const pageCount = total > 0n ? Number((total + PAGE_SIZE - 1n) / PAGE_SIZE) : 0

  const pageContracts = useMemo(() => {
    if (!merchant || pageCount === 0) return []
    return Array.from({ length: pageCount }, (_, i) => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getMerchantRequests' as const,
      args: [merchant, BigInt(i) * PAGE_SIZE, PAGE_SIZE] as [`0x${string}`, bigint, bigint],
      chainId: ARC_TESTNET_ID,
    }))
  }, [merchant, pageCount])

  const { data: pagesData, isLoading: loadingPages, error: pagesError, refetch: refetchPages } =
    useReadContracts({
      contracts: pageContracts,
      query: {
        enabled: pageContracts.length > 0,
        staleTime: 0,
        refetchInterval: 30_000,
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

  // Live status for each ID
  const statusContracts = useMemo(
    () => allIds.map(id => ({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'getRequest' as const,
      args: [id] as [bigint],
      chainId: ARC_TESTNET_ID,
    })),
    [allIds]
  )

  const { data: statusData, isLoading: loadingStatus, refetch: refetchStatus } =
    useReadContracts({
      contracts: statusContracts,
      query: {
        enabled: statusContracts.length > 0,
        staleTime: 15_000,
        refetchInterval: 30_000,
      },
    })

  // Map: id.toString() → OnchainRequest (only successful reads)
  const requestMap = useMemo(() => {
    const map = new Map<string, OnchainRequest>()
    if (!statusData) return map
    statusData.forEach((item, i) => {
      if (item.status === 'success' && item.result) {
        const req = item.result as OnchainRequest
        if (req.merchant !== '0x0000000000000000000000000000000000000000') {
          map.set(allIds[i].toString(), req)
        }
      }
    })
    return map
  }, [statusData, allIds])

  const isLoading = loadingTotal || (pageCount > 0 && loadingPages) || (allIds.length > 0 && loadingStatus)
  const error = totalError ?? pagesError ?? null

  const refetch = useCallback(async () => {
    await refetchTotal()
    await refetchPages()
    await refetchStatus()
  }, [refetchTotal, refetchPages, refetchStatus])

  // Requests with a failed status read — mark as incomplete
  const failedStatusCount = useMemo(() => {
    if (!statusData) return 0
    return statusData.filter(item => item.status === 'failure').length
  }, [statusData])

  return {
    allIds,
    total,
    requestMap,
    isLoading,
    error,
    refetch,
    failedStatusCount,
  }
}
