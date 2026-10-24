# ArcReceipt — Pending Work, Known Issues and Future Stages

> This file tracks everything not yet verified, implemented or resolved.
> Update it after every stage. Items are grouped by severity and stage.
> "Mocked" = verified by lint/typecheck only. "Onchain" = requires a live testnet transaction.

---

## CRITICAL — Must resolve before any production use

### C1: No live wallet tests run

All payment, receipt, cancellation and pending-restore flows have been verified by
code review and typecheck only. No actual transaction has been sent on Arc Testnet
in this development session.

**Required tests (none yet run):**

| ID | Test | Requires |
|----|------|---------|
| C1-T1 | Complete payment: scan merchant QR → approve → pay → receipt shown | Two wallets + testnet USDC |
| C1-T2 | Replacement TX: speed up a pay TX → checkout shows "unresolved", not "paid" | Wallet with speed-up support |
| C1-T3 | Pending restore: submit approve → refresh → restore to approving phase | One wallet |
| C1-T4 | Pending restore: submit pay → refresh → restore to paying phase | One wallet |
| C1-T5 | Pending cancel: submit cancel → refresh → cancel banner restored | One wallet |
| C1-T6 | Pending create: submit createRequest → refresh → confirming screen restored | One wallet |
| C1-T7 | Two equal-total orders A and B: pay only B → only B shows as Paid in Orders | Two wallets |
| C1-T8 | Receipt in fresh browser: open `/receipt/:id` with no wallet → TX hash recovered | No wallet |
| C1-T9 | Route crossover: navigate `/receipt/52` → `/receipt/53` → hash-52 not shown on 53 | No wallet |
| C1-T10 | Merchant scope: open `/merchant/orders/:id` as wrong merchant → read-only shown | Second merchant wallet |
| C1-T11 | Live paid-row update: pay from wallet B → wallet A's Orders row updates within ~8 s | Two wallets |
| C1-T12 | Revert: createRequest with insufficient balance → error shown, cart preserved | One wallet |
| C1-T13 | Self-payment: connected merchant tries to pay own request → warning shown, button disabled | One wallet |

**Status:** NONE RUN. All are blocked on testnet USDC and two wallets.

---

### C2: No independent security audit of the Solidity contract

The contract at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` has:
- 41 unit tests (passing)
- 2 invariant tests (passing)
- Internal code review only

No third-party audit has been performed. The contract handles real USDC on mainnet.
**Do not deploy to mainnet or use with real funds without an independent audit.**

Known contract properties (not audited):
- No custody: the contract calls `IERC20.transferFrom(payer, merchant, amount)` directly. USDC never enters the contract.
- No admin: there is no owner, no upgradeability, no pause function.
- No refunds: once paid, the transfer is final.
- No replay protection beyond the request ID uniqueness (auto-incremented counter).
- SelfPayment check: reverts if `payer == merchant`.

---

### C3: `VITE_APP_ORIGIN` not set in production build

The current `.env` does not set `VITE_APP_ORIGIN`. In a browser this is fine —
links use `window.location.origin` automatically. For any server-side generation
of QR codes or email links, set this before deploying.

**Action required:** set `VITE_APP_ORIGIN=https://your-production-domain.com` in the
Vercel environment variables (not in `.env` which is gitignored) before go-live.

---

## HIGH — Significant functionality gaps

### H1: Cancel row indicator not restored after refresh

**Status:** partially fixed (Stage 1).

**What works:** the cancel TX hash is persisted and the dashboard-level "Cancelling…"
banner is shown after refresh.

**What doesn't work:** the per-row cancel indicator (`cancellingId`) is not stored in
sessionStorage. After a refresh, the cancel banner shows correctly at the top but the
individual row does not show "Cancelling…" — it continues showing the previous status
(e.g., "Open") until the TX confirms and the row auto-refreshes.

**Impact:** minor UI confusion. The cancel IS still tracked — only the row-level
indicator is absent during restore.

**Fix:** persist `cancellingId` (the bigint request ID being cancelled) alongside the
cancel hash in pending-tx storage. Restore it on mount alongside the hash.

---

### H2: MerchantDashboard `cancellingId` uses === for bigint comparison

In `RequestRow`, the check `cancellingId === id` compares two BigInts. In most
runtimes, BigInt identity (`===`) works correctly between two `bigint` literals.
However, if `cancellingId` is restored from sessionStorage (where it must be
serialised/parsed), it may come back as a string or a different bigint instance.

**Current state:** `cancellingId` is a React state value of type `bigint | null`,
set by `setCancellingId(id)` where `id` is a BigInt from the contract read. It is
NOT restored from sessionStorage — it is lost on refresh (see H1). So the ===
comparison is safe in the current code, but will need auditing if H1 is fixed.

---

### H3: `PublicReceipt` skips failed getLogs chunks silently

In the TX hash recovery loop (`PublicReceipt`), a failed chunk is caught and the
loop continues to the next range. There is no count of failed chunks, no user-visible
warning, and no retry. If a rate-limit bursts during recovery, the TX hash may not
be found even though the payment is confirmed.

**Impact:** the receipt renders correctly (contract fields shown), but the "View
PaymentRecorded event" TX link may be absent. The fallback "View contract events
on explorer" link is shown instead.

**Fix (Stage 2 candidate):**
- Count failed ranges during recovery.
- Show a "Recovery incomplete — some blocks failed" message with a Retry button.
- Store failed ranges and retry on user request.

---

### H4: MyReceipts full-history scan may miss recent blocks

`MyReceipts` scans from `DEPLOYMENT_BLOCK` (67,462,931) to head in 2,000-block chunks.
If the chain is at block N and a payment happened at block N-1 (very recently), the
scan should still catch it — the `while (from <= head)` loop includes the head block.

However, if `head` is read before the most recent block containing a payment is
confirmed (race condition), the scan may not include that payment on first run.
The `refetchInterval: 6_000` on the contract read provides a natural retry path,
but `MyReceipts` does not have an auto-retry on completion.

**Fix (Stage 2 candidate):** re-fetch head and continue scanning after a short delay
on first completion, or add a "Scan for new payments" refresh button.

---

### H5: Reports `requestStatus()` uses live `requestMap`

The `requestStatus()` helper reads `req.status` from `requestMap` (populated via
`useMerchantAllRequests`). This is correct for showing current verified status.
However, it shows the CURRENT status, not the status at the time of the event —
e.g., a request that was Open at payment time and has since been cancelled may show
"Cancelled" in Reports rather than "Paid" (though `status === 1` is permanent once
set, so this specific case cannot happen; the concern is theoretical for future status
values).

**Current verdict:** safe for all three contract statuses (0=Open, 1=Paid, 2=Cancelled)
as Paid is a permanent terminal state.

---

## MEDIUM — Reliability and UX improvements

### M1: Stage 2 — Accurate/faster merchant reports and wallet payment history

Items from the original Part 2 plan:

**M1-A: Recent scan lookback gap**
`use-event-history` defaults to `recent` mode (head - 300,000 blocks). At Arc Testnet's
~2 blocks/second rate, 300,000 blocks = ~41 hours. This covers roughly 1.7 days.
For a merchant who last used the app 2 days ago, recent mode may miss some payments.
The merchant must manually trigger "Load full history" to see them.

**Fix options:**
- Increase the recent lookback to 500,000 blocks (~2.9 days).
- Auto-trigger a partial full-history scan if the recent scan produces 0 events (likely means the lookback is too short).

**M1-B: Today page "Awaiting" may include carried-over requests from before midnight UTC**
The "Awaiting" count in `MerchantTodayPage` shows all open (status=0, not expired)
requests from `requestMap`. It correctly distinguishes "created today" from "carried over".
The `useMerchantAllRequests` hook polls every 4 s — this is correct and current.

**Verified:** no double-counting bug found. The distinction is only cosmetic.

**M1-C: Reports bar chart does not handle periods with 0 payments**
If a day in the selected period has 0 payments, the chart renders a 0-height bar.
This is visually correct but the day label may be hard to read at very small heights.

**M1-D: CSV export uses `requestStatus()` which requires `requestMap` to be populated**
If the user exports before `requestMap` is fully loaded, some rows may show "Unknown"
status. The completeness guard prevents export during scanning, but `requestMap` loading
is separate from event scanning and may not be complete.

**Fix:** add a check that `requestMap` is loaded (no pending reads) before enabling export.

---

### M2: Stage 3 — UI polish, print layout, deployment preparation

**M2-A: Print layout**
Browser `window.print()` is used. Complex table pagination between pages depends on
the browser's print engine. A dedicated `@media print` CSS pass would improve this.

**M2-B: Testnet/mainnet banner**
There is no persistent "You are on testnet — USDC is not real" banner visible to
non-merchant users (customers). Adding one to `CustomerLayout` would reduce confusion.

**M2-C: Merchant settings persistence across sessions**
Menu items are in `sessionStorage` — they are lost on browser restart. For a permanent
food stall deployment, `localStorage` would be more appropriate. This is a deliberate
current design choice (avoids stale data), but it is a UX pain point.

**M2-D: Expiry presets in MerchantDashboard vs SellPage mismatch**
`MerchantDashboard.CreateForm` offers 5m/15m/30m/1d/3d/30d (6 options).
`SellPage` offers 5m/15m/30m/1d (4 options).
These should be unified or the difference should be intentional and documented.

**M2-E: `MerchantDashboard` in sell mode is a legacy route**
The original `MerchantDashboard` component supports `mode='sell'` which shows the
simple `CreateForm` (amount input). `SellPage` now provides the full POS experience.
`mode='sell'` is no longer used in the main routing. It can be removed in a future
cleanup pass.

---

### M3: Pending operations: requestId restoration for cancel

See H1 above. Full fix requires storing `cancellingId` in pending-tx sessionStorage.

---

## LOW — Known limitations (by design or acceptable trade-off)

### L1: No cross-device menu sync

Menu items are sessionStorage only. This is intentional — no database, no backend.
Document clearly in-app and in USAGE.md (done).

### L2: No delivery, loyalty, refunds

Explicitly out of scope per spec. No future work planned.

### L3: No WhatsApp / SMS / phone collection

Explicitly out of scope per spec.

### L4: 8 s maximum delay for paid-row update in Orders list

`RequestRowWithData` uses `refetchInterval: 8_000`. A payment confirmed in another
browser takes up to ~8 s to appear in the merchant's Orders row. This is an
intentional trade-off to avoid excessive RPC calls when many rows are mounted.

**Alternative:** use `staleTime: 0` + aggressive polling only for open rows, and
drop polling for paid/cancelled/expired rows (their status cannot change). This would
reduce load while keeping open-row updates fast.

### L5: Receipt TX recovery may take up to several minutes for old payments

The recovery loop scans from block 67,462,931 forward in 10,000-block chunks. For a
payment in an early block, many chunks must be processed before the TX hash is found.
This is an inherent cost of the getLogs approach without an indexed backend.

**Mitigation:** if `paidAt` block timestamp is known from the contract (it is —
`req.paidAt` is the block timestamp), the recovery loop could use it to estimate the
approximate block number (paidAt / ~0.5 blocks per second) and start much closer to
the right range. This would reduce recovery time from minutes to seconds in most cases.

**Status:** not yet implemented. Noted as a Stage 2 optimization.

### L6: Reports table "Status" column shows current status, not historical status at payment

By design — contract does not store historical status snapshots. "Paid" is permanent
so current status = historical status for paid requests.

### L7: `extractIdFromReceipt` searches all logs

`extractIdFromReceipt` iterates all logs in the receipt looking for a `RequestCreated`
event. This is efficient for a normal `createRequest` TX (1 log). For a batched TX
or a contract that emits many events, it would be slower, but those cases do not apply
to this contract.

### L8: `MerchantDashboard.CreateForm` does not sanitize the amount input with `parseUsdc`

The `CreateForm` amount input uses `parseFloat(amount) <= 0` as the pre-submit guard.
The actual `parseUsdc(amount)` validation runs in `handleCreateSubmit`. If a user
enters a value that passes `parseFloat > 0` but fails `parseUsdc` (e.g., too many
decimal places), they see an error after clicking "Confirm & sign in wallet" instead
of earlier on the Review screen.

**Fix (minor UX):** run `parseUsdc` in the Review step and show the error before
the wallet prompt.

---

## FUTURE STAGES

### Stage 2 (not yet started): Accurate/faster reports and wallet payment history

Planned scope:
1. Increase recent scan lookback from 300,000 to 500,000 blocks.
2. Add per-row auto-stop polling for paid/cancelled rows (see L4).
3. Add "Receipt TX recovery optimization using paidAt block estimate" (see L5).
4. Fix CSV export to require `requestMap` loaded before enabling (see M1-D).
5. Add failed-range tracking and Retry to `PublicReceipt` recovery (see H3).
6. MyReceipts: add auto-rescan after first completion (see H4).
7. Reports `requestMap` completeness gate before CSV export.
8. Run live wallet tests C1-T1 through C1-T13 and update checklist.

### Stage 3 (completed 2026-10-23): UI polish, deployment checks, mainnet submission

Completed items:
1. ✅ Merchant workspace entry added to Home and CustomerLayout (wallet-gated).
2. ✅ How-it-works 3-step panel on Home page.
3. ✅ Print layout `@media print` CSS pass in index.css.
4. ✅ Menu storage changed from sessionStorage to localStorage (durable).
5. ✅ PublicReceipt: Copy link + Copy TX buttons.
6. ✅ DEPLOYMENT-GUIDE.md: mainnet steps, security headers, submission checklist.

Remaining from Stage 3 scope (not done):
- Unify expiry presets between MerchantDashboard and SellPage (M2-D above).
- Remove `MerchantDashboard mode='sell'` dead code (M2-E above).
- `VITE_APP_ORIGIN` production env var (C3 above — requires Vercel env var, not code change).
- Mainnet deployment (requires independent audit — see C2 above).

Post-Stage-3 correction applied:
- ✅ Merchant workspace links removed from public Home and CustomerLayout per user direction.
  Merchant workspace is accessible only via direct URL `/merchant` with wallet gate.

---

## INVARIANTS TO PRESERVE IN FUTURE STAGES

These are correctness properties that must not be broken by any future change:

1. **Contract is authoritative.** Amount, merchant, expiry, payer, paidAt are always
   read from `getRequest(id)`. Never inferred from URL parameters, sessionStorage, or
   event data alone.

2. **Payment evidence validation.** `onPaid()` only fires when a `PaymentRecorded`
   event matching (id, merchant, payer, amount) is found in the confirmed receipt.

3. **Pending TX binding.** SessionStorage keys include chainId + contract + account +
   requestId. No cross-account or cross-chain contamination.

4. **Deployment block.** All getLogs scans start from block 67,462,931. Never change
   this without redeploying the contract.

5. **Canonical URLs.** `buildPaymentLink(id)` → `/pay/:id`. `buildReceiptLink(id)` →
   `/receipt/:id`. Legacy `?request=N` links redirect to these. Never generate new
   query-string links.

6. **USDC decimals.** All arithmetic uses raw `bigint` with `parseUsdc`/`formatUsdc`
   at UI boundaries only. Never use `parseFloat` or floating-point on USDC amounts.

7. **Receipt hash isolation.** A TX hash confirmed for request A must never be shown
   for request B. `reportedHash` ref resets on `requestId` change. `recoveredTxHash`
   state resets on unmount (which happens on route change).

8. **Merchant scope.** Management controls (QR, cancel, present, next order) only render
   when `req.merchant === MERCHANT_ADDRESS` and the connected wallet matches.

9. **No auto-resubmit.** Pending TX restoration on refresh never sends a new transaction.
   It only reconnects wagmi's `useWaitForTransactionReceipt` to the existing hash.

10. **Equal-total orders are distinct.** Never identify an order by matching its amount.
    Always use the request ID (uint256, auto-incremented by the contract).

---

## DEPLOYMENT GATE

**Do NOT merge to main or deploy to production until:**

- [ ] C1: Live wallet tests C1-T1 through C1-T13 all pass.
- [ ] C2: Independent Solidity security audit completed and findings resolved.
- [ ] C3: `VITE_APP_ORIGIN` set to production URL in Vercel env vars.
- [ ] Stage 2 items M1-A (scan lookback) and M1-D (CSV export guard) resolved.
- [ ] Zero lint errors and zero TypeScript errors (`bash /home/user/arc-studio-helpers/check.sh`).
- [ ] `bunx vite build` succeeds with zero errors.
- [ ] `dist/vercel.json` present after build.
- [ ] Final USAGE.md reviewed for accuracy against the actual deployed build.
