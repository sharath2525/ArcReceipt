# ArcReceipt — Pending Work and Known Issues

> Open items only. Completed tests and resolved fixes are in COMPLETED.md.
> Updated: 2026-10-27

---

## CRITICAL — Must resolve before mainnet/production

### C2: No independent security audit

The contract at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` has passed all internal tests but has not been reviewed by an external auditor. **Do not deploy to mainnet or use with real funds without an independent audit.**

Known safe properties (not a substitute for audit):
- No custody: USDC goes direct customer → merchant, contract balance stays zero.
- No owner or admin: nobody can pause, freeze or modify after deployment.
- No upgradeability: code is permanently fixed.
- ReentrancyGuard on `pay()`.
- SafeERC20 `safeTransferFrom`.
- SelfPayment revert.

Recommended path: Cyfrin, 0xMacro, or run Slither + Aderyn and publish reports as minimum due diligence. See `DEPLOYMENT-GUIDE.md`.

---

### C3: `VITE_APP_ORIGIN` must be set in Vercel before go-live

Set `VITE_APP_ORIGIN=https://arc-mr.vercel.app` in Vercel → Settings → Environment Variables.
Currently set in sandbox `.env` ✅ and in Vercel ✅. Rebuild required after any domain change.

---

## HIGH — Significant gaps

### H1: Cancel row indicator lost on refresh

**What works:** cancel TX hash persisted, dashboard-level "Cancelling…" banner restores on refresh.
**What doesn't:** per-row `cancellingId` state is not persisted. After refresh, the individual row shows "Open" until the TX confirms instead of "Cancelling…".
**Impact:** minor visual confusion. Cancel IS tracked — only the row indicator is missing.
**Fix:** persist `cancellingId` alongside cancel hash in pending-tx storage.

---

### H2: `cancellingId` bigint comparison caveat

`cancellingId === id` is safe today (both are fresh bigints from React state, not restored from storage). If H1 is fixed and `cancellingId` is restored from sessionStorage (where bigints must be serialised), the comparison must be changed to `cancellingId.toString() === id.toString()`.

---

### H3: PublicReceipt skips failed getLogs chunks silently

During TX hash recovery, a failed chunk is caught and skipped. No count, no warning, no retry button. If rate-limiting occurs, the TX link may be absent even though the payment is confirmed.
**Fix:** count failed ranges, show "Recovery incomplete — retry" button, store and retry failed ranges.

---

### H4: MyReceipts may miss very recent blocks on first scan

If `head` is read just before a payment is confirmed (race condition), that payment may not appear on first scan completion. No auto-rescan after completion.
**Fix:** re-read head and scan the new tail after a short delay on completion, or add "Check for new payments" button.

---

## MEDIUM — Reliability and UX

### M1-A: Merchant recent scan lookback (41 hours)

`use-event-history` defaults to head - 300,000 blocks (~41 hours at Arc Testnet block rate). A merchant inactive for 2+ days must manually trigger "Load full history".
**Fix:** increase lookback to 500,000 blocks (~2.9 days), or auto-trigger full scan when recent scan returns 0 events.

---

### M1-D: CSV export may show "Unknown" status if requestMap not fully loaded

The completeness guard blocks export during scanning, but `requestMap` loading is separate and may not be complete.
**Fix:** add a check that all `requestMap` reads are settled before enabling export.

---

### M2-D: Expiry presets mismatch between MerchantDashboard and SellPage

`MerchantDashboard.CreateForm` offers 5m/15m/30m/1d/3d/30d.
`SellPage` offers 5m/15m/30m/1d.
Should be unified or the difference documented as intentional.

---

### M2-E: `MerchantDashboard mode='sell'` is dead code

`mode='sell'` is no longer used in routing — `SellPage` replaced it. Can be removed in a cleanup pass.

---

## LOW — Known limitations (by design)

| ID | Limitation | Decision |
|----|-----------|---------|
| L2 | No delivery, loyalty, refunds | Out of scope |
| L3 | No WhatsApp/SMS/phone collection | Out of scope |
| L4 | Orders row update delay up to ~8s | Intentional RPC rate trade-off |
| L5 | Receipt TX recovery slow for old payments | No indexed backend; paidAt-block estimate would help |
| L6 | Reports "Status" shows current status, not historical | Paid is permanent terminal state — safe by design |
| L7 | `extractIdFromReceipt` iterates all logs | Fine for single-event TX; not a concern for this contract |
| L8 | `CreateForm` amount validated after wallet prompt | Minor UX: run `parseUsdc` earlier in Review step |

---

## MAINNET CHECKLIST (do not deploy until all checked)

- [ ] C2: Independent Solidity audit completed and findings resolved
- [ ] Run Slither + Aderyn, publish automated reports in repo
- [ ] Verify Arc Mainnet USDC address against official Circle docs
- [ ] Deploy new contract to Arc Mainnet (testnet contract is testnet-only)
- [ ] Update `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` in frontend source
- [ ] Update `VITE_APP_ORIGIN` in Vercel to mainnet domain
- [ ] Update `VITE_MERCHANT_ADDRESS` to mainnet merchant wallet(s)
- [ ] Rebuild and redeploy frontend
- [ ] Test one real USDC payment end-to-end before publishing link
- [ ] See `DEPLOYMENT-GUIDE.md` for full step-by-step

---

## INVARIANTS (must not break in future changes)

1. Contract is authoritative — amount, merchant, expiry, status, payer, paidAt always from `getRequest(id)`.
2. `onPaid()` only fires when `PaymentRecorded` event validates (id, merchant, payer, amount).
3. Pending TX keys include chainId + contract + account + requestId — no cross-account contamination.
4. All getLogs scans start from block 67,462,931 — never change without redeploying the contract.
5. `buildPaymentLink` → `/pay/:id`, `buildReceiptLink` → `/receipt/:id` — no new query-string links.
6. All USDC arithmetic uses raw bigint with `parseUsdc`/`formatUsdc` at UI boundaries only.
7. TX hash confirmed for request A is never shown for request B.
8. Management controls only render when `req.merchant` matches a configured address AND connected wallet matches.
9. Pending TX restore never resubmits — only reconnects `useWaitForTransactionReceipt`.
10. Orders are identified by request ID, never by amount.
