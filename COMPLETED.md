# ArcReceipt — Completed Tests and Resolved Issues

> Reference log of everything verified or resolved.
> Move items here from PENDING.md once confirmed working.
> Never delete from this file — it is a permanent record.

---

## Live Wallet Tests — C1 (Tested 2026-10-27 on Arc Testnet)

All tests run against the deployed contract at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` on Arc Testnet (chain 5042002). URLs used: `https://arc-mr.vercel.app`.

| ID | Test | Result | Notes |
|----|------|--------|-------|
| C1-T1 | Complete payment: scan QR → approve → pay → receipt shown | ✅ PASS | Wallet A paid `/pay/71`. Wallet B receipt at `/receipt/75`. Both confirmed. |
| C1-T2 | Failed TX shows error and retry works | ✅ PASS | Tested with insufficient balance — failed correctly. Retry after funding worked. Partial: error message was generic (now fixed with better decoding). |
| C1-T3 | Pending restore — refresh during approve phase | ✅ PASS | Phase restored correctly after refresh. |
| C1-T4 | Pending restore — refresh during pay phase | ✅ PASS | Phase restored correctly after refresh. |
| C1-T5 | Pending cancel — refresh during cancel TX | ✅ PASS | Cancel banner restored after refresh as expected. |
| C1-T6 | Pending create — refresh during createRequest TX | ✅ PASS | Confirming screen restored after refresh. |
| C1-T7 | Two equal-total orders — only the paid one shows Paid | ✅ PASS | Orders correctly distinguished by ID, not amount. |
| C1-T8 | Receipt in a fresh browser (no wallet) | ✅ PASS | Receipt loads and shows all fields without connecting a wallet. |
| C1-T9 | Route crossover — hash from order A not shown on order B | ✅ PASS | Bug found: paid request showed countdown in red. Fixed post-test (settled requests suppress urgency). |
| C1-T10 | Merchant scope guard — wrong wallet gets read-only view | ✅ PASS | Non-merchant wallet connecting at `/pay/85` correctly shown wallet-connect prompt, then "not merchant" message. Management controls hidden. |
| C1-T11 | Live paid-row update in Orders | ✅ PASS | Row updated within ~8s of payment from another browser. |
| C1-T12 | Revert on createRequest (insufficient balance) | ✅ PASS | Error shown. Partial: error message was not human-readable (now fixed with better decoding). |
| C1-T13 | Self-payment attempt | ✅ PASS | Merchant wallet shown correct warning, button disabled. |

**Result: 13/13 tests passed.** Two minor display bugs found and fixed during testing (C1-T9, C1-T12).

---

## Multi-address merchant access (Tested 2026-10-27)

| Test | Result | Notes |
|------|--------|-------|
| Second merchant address (`0x621f...eA30`) accesses workspace | ✅ PASS | After env var update and redeploy, second address granted full workspace access. |
| Orders from wallet A and wallet B show correct request IDs | ✅ PASS | Wallet A created request #87 after wallet B created #86 — IDs are correct global sequence. |
| Merchant gate shows no wallet addresses to the public | ✅ PASS | Gate shows neutral message only, no address hint. |

---

## Stage 1 — Code-verified fixes (2026-10-23)

| ID | Fix | Verified by |
|----|-----|-------------|
| S1-1 | `buildPaymentLink`/`buildReceiptLink` emit path-based URLs | Code review + typecheck |
| S1-2 | `'pay'` added to `PendingAction` union | Code review + typecheck |
| S1-3 | `validatePaymentReceipt()` in PublicCheckout — validates event before `onPaid()` | Code review + typecheck |
| S1-4 | `'unresolved'` phase added for TX-confirmed-but-no-event case | Code review + typecheck |
| S1-5 | `reportedHash.current` reset on `requestId` change | Code review + typecheck |
| S1-6 | Create receipt: `extractIdFromReceipt` null → `rpc-error` banner | Code review + typecheck |
| S1-7 | Cancel: `savePendingTx` on submission | Code review + typecheck |
| S1-8 | Cancel hash restored on mount and wallet change | Code review + typecheck |
| S1-9 | `RequestRowWithData`: `staleTime` 30s→5s, `refetchInterval: 8_000` | Code review + C1-T11 live test |
| S1-10 | `isMerchantOrder` guard on MerchantOrderDetailPage | Code review + C1-T10 live test |

---

## Stage 2 — Code-verified fixes (2026-10-23)

| ID | Fix | Verified by |
|----|-----|-------------|
| S2-1 | Adaptive chunk size: starts 9,999, halves on error, min 1,000 | Code review |
| S2-2 | Parallel `getLogs` per chunk | Code review |
| S2-3 | Block-timestamp cache across chunks | Code review |
| S2-4 | Tail-refresh: warm cache resumes from `tailCursor + 1` | Code review |
| S2-5 | `recentComplete` flag exposed on hook | Code review |
| S2-6 | Reference block pinned for all paginated reads | Code review |
| S2-7 | `requestMap` skips wrong-merchant entries | Code review |
| S2-8 | Status reads: `staleTime: 5s / refetchInterval: 15s` | Code review + C1-T11 live test |
| S2-9 | `previousMonthStart(ts)` — correct for all months | Code review |
| S2-10 | Last-month period uses `previousMonthStart` | Code review |
| S2-11 | "Load full history" always visible in ScanBanner | Code review |
| S2-12 | DetailTable "Sort by" toggle actually re-sorts rows | Code review |
| S2-13 | `isIncomplete` uses `coverageComplete` | Code review |
| S2-14 | "Collected today" reads from `requestMap` (contract) | Code review |
| S2-15 | Today page `isIncomplete` uses `coverageComplete` | Code review |
| S2-16 | Generation counter in MyReceipts | Code review |
| S2-17 | Retry / Update / Rebuild buttons with distinct semantics | Code review |
| S2-18 | "View receipt" link per payment row | Code review |

---

## Stage 3 — Code-verified fixes (2026-10-23)

| ID | Fix | Verified by |
|----|-----|-------------|
| S3-1 | Menu storage: sessionStorage → localStorage | Code review |
| S3-2 | Home page: "How it works" 3-step panel | Code review |
| S3-3 | PublicReceipt: Copy link + Copy TX buttons | Code review |
| S3-4 | `@media print` CSS: hides nav/header, clean output | Code review |
| S3-5 | Merchant workspace links removed from public Home and CustomerLayout | Code review + visual check |
| S3-6 | `DEPLOYMENT-GUIDE.md` written | Written |

---

## Post-Stage-3 fixes

| Date | Fix | Verified by |
|------|-----|-------------|
| 2026-10-24 | Expiry notification: toast fires on open→expired transition | Code review |
| 2026-10-24 | Expiry notification: mid-flow warning if TX in-flight | Code review |
| 2026-10-24 | `MyReceipts` chunk size 10,000→9,999 (Arc RPC hard limit) | Code review |
| 2026-10-24 | `MyReceipts` cache to localStorage (survives reload) | Code review |
| 2026-10-24 | `MyReceipts` lookback-based start block (500k blocks, not full history) | Code review |
| 2026-10-24 | Inter-chunk delay added to `MyReceipts` | Code review |
| 2026-10-25 | Failed pay TX: `isError` handled — error shown, retry enabled | Code review + C1-T2 live test |
| 2026-10-25 | Live countdown timer on checkout page | Code review |
| 2026-10-26 | Cart cleared on "Next order" from MerchantOrderDetailPage | Code review |
| 2026-10-26 | Multi-address merchant support via comma-separated `VITE_MERCHANT_ADDRESS` | Code review + live test |
| 2026-10-27 | Countdown red suppressed on paid/cancelled requests (C1-T9) | Code review + live test |
| 2026-10-27 | Better error decoding for createRequest and cancel failures (C1-T12) | Code review + live test |
| 2026-10-28 | H1: `cancellingId` persisted and restored from pending-tx meta on refresh | Code review |
| 2026-10-28 | H2: `isThisCancelling` now uses `.toString()` comparison (bigint safe after restore) | Code review |
| 2026-10-28 | H3: PublicReceipt recovery now counts failed chunks, shows warning + Retry button | Code review |
| 2026-10-28 | H4: MyReceipts auto-tail-refresh 5s after first scan completion | Code review |
| 2026-10-28 | M1-A: Merchant scan lookback confirmed at 500k blocks (~2.9 days) | Code review |
| 2026-10-28 | M1-D: CSV export gates on `requestMap` fully loaded; warns if partial | Code review |
| 2026-10-28 | M2-D: Expiry presets unified to 5m/15m/30m/1hr across MerchantDashboard + SellPage | Code review |
| 2026-10-28 | M2-E: `MerchantDashboard mode='sell'` dead code removed; `CreateForm` removed | Code review |
| 2026-10-28 | C3: `VITE_APP_ORIGIN` set to `https://arc-mr.vercel.app` in Vercel env vars | Live confirmed |
