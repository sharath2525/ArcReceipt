# ArcReceipt — Usage Guide

> Complete reference for running, operating, deploying and diagnosing ArcReceipt.
> Every feature, every corner case, every known warning, and every production checklist item.

---

## 1. Live URLs

| Purpose | URL |
|---|---|
| Production (stable) | https://arc-studio-47505b56e0b14c9699dab416.vercel.app |
| Home / search | `/` |
| Merchant sell (POS) | `/merchant` |
| Today dashboard | `/merchant/today` |
| All orders | `/merchant/orders` |
| Order detail + QR | `/merchant/orders/:requestId` |
| Reports | `/merchant/reports` |
| Settings | `/merchant/settings` |
| Developer demo | `/merchant/demo` |
| Customer checkout | `/pay/:requestId` |
| Customer receipt | `/receipt/:requestId` |
| Wallet-free verify | `/verify` |
| My payment history | `/payments` |

Legacy query-string links (`?request=N`, `?view=orders`, etc.) are redirected
by `LegacyRedirect` and continue to work. Do not rely on them for new links — use
path-based URLs only.

---

## 2. Contract

| Field | Value |
|---|---|
| Address | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` |
| Chain | Arc Testnet (chain ID 5042002) |
| Deployment block | 67,462,931 |
| Deploy TX | `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45` |
| Deployed | 2026-10-16T07:21:04 UTC |
| Explorer | https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18 |
| USDC address | `0x3600000000000000000000000000000000000000` (6 decimals) |

The contract is the sole source of truth for:
- Payment amount, merchant address, expiry timestamp, request status
- Payer address and paid timestamp (set on payment)

Nothing in localStorage, sessionStorage, URLs, or query strings overrides contract data.

---

## 3. Merchant access

### 3.1 Configure the merchant wallet

```
VITE_MERCHANT_ADDRESS=0xD995d0c31802A8D95C163f875fFefB40AB964eD6
```

Set this in `.env` before building. The merchant workspace (`/merchant/*`) is
only visible when the connected wallet matches this address.

**Important:** this is a frontend UI gate only. The contract allows any wallet to
call `createRequest` directly on-chain. The gate prevents non-merchants from
seeing the sell screen and order management — it does not prevent onchain calls.

### 3.2 Merchant scope guard (Stage 1 fix)

Order detail pages (`/merchant/orders/:id`) now check whether `req.merchant`
(from the contract) matches `VITE_MERCHANT_ADDRESS` AND the connected wallet.
If someone navigates directly to another merchant's order URL:
- The order fields (amount, status, expiry) are shown in read-only mode.
- QR code, Present order, Next order, and Copy link are **hidden**.
- An amber notice is displayed: "This request belongs to a different merchant address."

Management controls are never shown purely based on URL — contract data is always checked.

### 3.3 Add multiple merchants

```
VITE_MERCHANT_ADDRESS=0xFirst...,0xSecond...,0xThird...
```

Then edit `src/lib/merchant.ts` to split on commas:
```ts
const allowed = (import.meta.env.VITE_MERCHANT_ADDRESS || '')
  .split(',').map(a => a.trim().toLowerCase())
return allowed.includes(connectedAddress.toLowerCase()) ? 'authorized' : 'unauthorized'
```
Rebuild and redeploy after this change.

---

## 4. Merchant features

### 4.1 Sell (POS) — `/merchant`

The Sell tab is the primary point-of-sale screen.

**Cart mechanics:**
- Tap a menu item to add it. Tap again to add another unit.
- Adjust quantity with +/– controls.
- Remove individual items with ×.
- Clear all with "Clear".
- Custom amount: enter any positive USDC amount in the "Custom amount" field and press Add.

**Cart validation (enforced before wallet prompt):**
- Empty cart is rejected.
- Each item price must pass `parseUsdc()`: positive decimal, max 6 dp, no negatives, no hex, no scientific notation.
- Zero total is rejected.
- uint256 overflow (total > `2^256 - 1`) is rejected.
- Cart is frozen at the moment "Create order in wallet" is signed — subsequent menu edits do not affect the submitted amount.

**Expiry presets:** 5 m · 15 m · 30 m · 1 d. Selected at submit time. Expiry is stored onchain and cannot be changed.

**Order creation flow:**
1. Cart → tap "Create order · X USDC" → Review screen.
2. Review screen shows exact amount, expiry, network (Arc Testnet 5042002), merchant address.
3. Sign in wallet → TX submitted → "Confirming order…" screen with explorer link.
4. On confirmed `RequestCreated` event with a valid ID → navigate to order detail.
5. On TX confirmed but **no `RequestCreated` event found** → error banner, tracking is kept, do NOT send a second TX.
6. On revert → error shown, cart preserved.
7. On wallet rejection → error shown, cart preserved.
8. Pending hash is persisted to sessionStorage keyed by `chainId + contract + account`. Refresh restores the "Confirming…" screen — it does NOT resend the TX.

**Local items vs onchain terms:**
- Menu item names, prices and emojis are stored in `sessionStorage` (merchant's browser only).
- They are NOT stored onchain. They are NOT visible to customers. They are local notes.
- The item list is clearly labelled "Order items (merchant reference only)" on the confirmed card.
- Payment amount is the only onchain term — it is immutable after creation.
- Do NOT rely on item history across devices or browsers.

**Menu editing (inline):**
- Each menu card has a pencil icon for inline editing on the Sell screen.
- Full add/remove/reorder/disable is in Settings (`/merchant/settings`).

**Custom amount:**
- Supports any positive USDC value (e.g., "7.50", "100").
- Subject to the same `parseUsdc` validation as menu items.
- Appears in cart as "Custom × 1".

**Next order:**
- Clears only the current draft cart and confirmed order state.
- Does NOT cancel the onchain request — that request remains open.
- Separately edited drafts (started after creation) are preserved if the merchant built them.

### 4.2 Orders — `/merchant/orders`

Lists all requests ever created by the connected merchant, newest first.

**Pagination:** the contract exposes `getMerchantRequests(address, offset, limit)`. The dashboard reads the total count first (limit=0), then fetches all pages in parallel. All IDs are assembled and sorted descending by ID. There is no hardcoded page cap — 200+ orders are fully supported.

**Status filters:** All · Open · Paid · Expired · Cancelled.

**Per-row live refresh (Stage 1 fix):**
- `staleTime: 5_000`, `refetchInterval: 8_000`.
- A row paid from another browser/wallet updates within ~5–8 s of payment.
- RPC errors on individual rows show a red inline error with a Retry button — they do not hide the row or show an incorrect status.

**Cancel:**
- The Cancel button submits a `cancelRequest(id)` TX.
- The hash is persisted to sessionStorage immediately on submission.
- Refresh during cancel confirmation restores the "Cancelling…" status without resending the TX.
- On confirmed cancel: row status updates, persisted hash is cleared.
- On revert or RPC error: error shown, hash kept so the user can check the explorer.
- Cancel confirmation fires only when `receipt.status === 'success'` — submission alone is not enough.

**Show QR / Copy link in row:** shows the canonical `/pay/:id` URL. The link always reads payment terms from the contract — sharing it from the Orders list is safe even days later.

**Order detail — `/merchant/orders/:id`:**
- Reads all fields live from the contract: amount, status, merchant, expiry, payer, paidAt.
- QR code uses the canonical `/pay/:id` URL.
- "Present order" opens a fullscreen overlay with large QR + amount for counter display.
- "Open receipt" navigates to `/receipt/:id`.
- "Shareable receipt link" opens `/receipt/:id` in a new tab.
- All management actions (QR, Present, Copy, Next order) require `req.merchant === MERCHANT_ADDRESS` AND connected wallet = merchant. Otherwise read-only mode is shown.

### 4.3 Today — `/merchant/today`

Displays UTC-day summary. All times are UTC (midnight UTC = 05:30 IST).

**Stat cards (clickable drill-downs):**
- **Collected today:** sum of `PaymentRecorded.amount` for events whose `paidAt` falls in the current UTC day. Drill-down lists each payment with time, payer, amount, receipt link.
- **Orders today:** count of `RequestCreated` events whose `createdAt` falls in the current UTC day. Drill-down lists each order with time and order link.
- **Awaiting payment:** live paginated count of open (status=0, not expired) requests from `getMerchantRequests`. Distinguishes requests created today from "carried over" (created before midnight UTC). Drill-down links to each order's QR.
- **This month:** sum of `PaymentRecorded.amount` for events in the current UTC calendar month.

**Scan completeness:**
- Values show a `~` prefix when the scan is in "recent" mode (not full history).
- "Full history loaded" shows without `~`.
- Rollover check fires every 60 s and on tab visibility change — crossing midnight UTC recomputes today's window without a page reload.

**Known limitation:** event history is fetched from the blockchain (getLogs). The first load in recent mode scans ~300,000 blocks forward from the current head. If today's payments fall outside this window, they will be missed until "Load full history" is triggered.

### 4.4 Reports — `/merchant/reports`

Full historical reporting with period picker, bar chart, table, CSV export and print.

**Period picker:** Today · Yesterday · This month · Last month · Custom UTC range.

**Date filter:** "Filter by payment date" or "Filter by creation date". All filters are applied to the selected date range using the chosen field.

**Summary row:** USDC collected, payment count, requests created — all with `~` prefix during incomplete scans.

**Bar chart:** daily collection in USDC for the selected period (SVG, no external library). Click a bar to jump to that day's rows in the table.

**Detailed table:** Request ID · Created UTC · Paid UTC · Amount · Payer · Status · Receipt · Explorer. Each row links to the receipt and the contract explorer.

**Status filter in table:** All · Paid · Open · Expired · Cancelled. Status is read live from the `requestMap` (via `getMerchantRequests`), not inferred from event data alone.

**CSV export:**
- Blocked when scan is incomplete (unless user explicitly confirms "export partial data").
- All string fields are quoted and formula-injection characters (`=`, `+`, `-`, `@`) are prefixed with `'`.
- Filename includes UTC timestamp and period label.
- Does not include local item descriptions (not onchain).

**Print:** browser `window.print()`. Print layout collapses filters and shows a completeness note in the footer.

**Scan mode:**
- Default: "recent" — scans the most recent ~300,000 blocks (covers approximately 1–2 days on Arc Testnet at ~2 blocks/second).
- "Load full history" — scans from deployment block 67,462,931 to head. On Arc Testnet this is ~65M blocks and takes several minutes. Progress is shown live.
- Incomplete scans show failed ranges with individual Retry buttons — failed ranges are not silently zeroed.

### 4.5 Settings — `/merchant/settings`

Manage menu items:
- Add new items (name, price, emoji, optional image URL).
- Edit existing items inline.
- Toggle availability (hidden items do not appear on the Sell screen).
- Reorder by drag or up/down buttons.
- Set a custom `https://` image URL for any item.
- Reset to sample menu (4 items: Burger 2 USDC, Coke 3 USDC, Fries 1 USDC, Coffee 2 USDC).

Menu data is stored in `sessionStorage` scoped to `chainId + contract + merchant address`.
It is NOT synced across devices. It is NOT onchain. It is a local convenience only.

---

## 5. Customer features

### 5.1 Checkout — `/pay/:requestId`

Wallet-connected payment flow. No login, no account, no phone number required.

**What the URL provides:** only the request ID. Amount, merchant, expiry and status are always read from the contract.

**Payment flow (two steps):**
1. **Approve** — grants `CONTRACT_ADDRESS` an ERC-20 allowance of exactly `req.amount` USDC. This step is **skipped** if the current allowance is already ≥ `req.amount`.
2. **Pay** — calls `contract.pay(requestId)`, which transfers USDC and records `PaymentRecorded(id, merchant, payer, amount, paidAt)`.

Both steps use a single `useWriteContract` hook — two simultaneous wallet requests are impossible.

**Pending hash persistence:**
- `approveHash` and `payHash` are written to sessionStorage keyed by `chainId + contract + account + requestId`.
- Refresh restores the in-progress phase without resending any TX.
- Account or network change clears and resets the state for that wallet.
- Wallet A's hashes cannot appear under wallet B's key.

**Payment evidence validation (Stage 1):**
After wagmi confirms the pay TX, every log in the receipt is inspected for a `PaymentRecorded` event that matches:
- `log.address === CONTRACT_ADDRESS`
- `topic-0 === PAYMENT_RECORDED_TOPIC`
- Decoded `id === requestId` (bigint equality)
- Decoded `merchant === req.merchant`
- Decoded `payer === connected wallet address`
- Decoded `amount === req.amount`

If all checks pass → `phase = 'done'`, success screen shown, `onPaid(payHash)` called.
If the TX confirmed but no matching event is found → `phase = 'unresolved'`, amber warning shown. The payment session is NOT cleared. The customer is told: "Do not pay again — check the explorer first."

**Unresolved outcome screen:** shows the TX explorer link, current contract status (Open/Paid/etc.), and a "Check again" button that re-reads contract state. Does not claim payment success. Does not auto-retry.

**Replacement TX:** if a wallet speed-up or replacement TX is mined without the intended `pay(requestId)` call, the unresolved screen is shown. If the contract now shows `status=1 (Paid)`, the customer is informed no further action is needed.

**Error states handled:**
- User rejection → "You rejected the request in your wallet."
- Insufficient USDC → "Insufficient USDC balance or gas."
- Self-payment (`SelfPayment` revert) → "You are the merchant — connect a different wallet."
- Request not open (`RequestNotOpen` / `RequestNotFound`) → "This request is no longer available."
- Request expired (`RequestExpired`) → "This request has expired."
- Allowance insufficient → "USDC allowance insufficient. Please approve first."
- Network changed mid-flow → "Network changed — switch back to Arc Testnet."
- Timeout / RPC failure → "Network error — check your connection and try again."

**Paid request:** if the contract already shows status=1, the checkout shows "Already paid" with payer address and timestamp. No payment buttons are shown.

**Expired/cancelled:** shows "Request expired" or "Request cancelled". No payment buttons.

**Wrong network:** shows "Switch to Arc Testnet" button. Does not show payment button until the right chain is active.

**No wallet:** shows ConnectKit connect button.

**Merchant viewing their own checkout:** shows "You created this request — connect a different wallet to pay." Payment buttons are disabled.

**requestId change guard (Stage 1):** if the URL changes from `/pay/52` to `/pay/53` (e.g. history navigation), `reportedHash` is reset to null so request 52's successful payment cannot suppress request 53's success detection. All per-request refs reset on requestId change.

### 5.2 Receipt — `/receipt/:requestId`

Wallet-free receipt. No wallet connection required to view any receipt.

**What is shown:**
- Request ID, amount (from contract), merchant address (from contract) with explorer link.
- Status: Payment confirmed / Open — not yet paid / Cancelled / Expired.
- If paid: payer address (from contract), paid timestamp (from contract).
- Onchain evidence section: explorer link to the `PaymentRecorded` TX.
- Verified source block: contract address, chain name.

**TX hash recovery (fresh browser):**
When a receipt URL is opened in a fresh browser (no router state, no sessionStorage), the component searches onchain for the `PaymentRecorded` event using typed `getLogs` filtered by `id = requestId`. This recovers the exact transaction hash for the explorer link. Progress is shown ("Recovering transaction from chain…"). If recovery fails, the receipt still renders — the contract fields are shown, with a fallback link to all contract events.

**Hash is verified, not trusted:** URL query strings and sessionStorage hashes are treated as hints only. The receipt only shows the TX link after verifying it matches the request via the onchain log.

**Navigation between receipts:** The `recoveredTxHash` state resets on unmount. Navigating from `/receipt/52` to `/receipt/53` starts a fresh recovery for ID 53 — hash from request 52 is never shown for request 53.

**Print receipt:** browser `window.print()`.

**Key invariant:** paid status is determined by `req.status === 1` (from contract). Expiry of the original request does NOT change a paid request to "Expired". A paid request that has since passed its original expiry still shows "Payment confirmed".

### 5.3 My payments — `/payments`

Wallet-connected payment history for the connected wallet address.

Shows all `PaymentRecorded` events where `payer === connected address`.

**Scan:** scans from deployment block 67,462,931 to head in 2,000-block chunks. Progress is shown live. Newest-first ordering.

**Completeness:** shows "Scan incomplete — some records may be missing" while scanning. Never claims an empty history is confirmed empty until the scan is complete.

**Individual receipt links:** each payment row links to `/receipt/:id`.

**Scope:** scoped to connected wallet and current chain/contract. Wallet change clears and restarts the scan for the new wallet.

### 5.4 Verify — `/verify`

Wallet-free receipt lookup by request ID. Enter any request ID to see its contract state. Uses `PublicReceipt` — identical to `/receipt/:id` in terms of data shown and TX hash recovery.

---

## 6. Event history and scanning

### 6.1 How getLogs scanning works

The app scans `PaymentRecorded` and `RequestCreated` events from block 67,462,931 forward. It uses viem's typed `getLogs` with `event` and typed `args` filters so only events for the merchant's address are fetched.

**Chunk sizes:**
- Report/Today scan: 2,000 blocks per chunk.
- Receipt TX recovery: 10,000 blocks per chunk.

**Rate limiting:** chunks are executed sequentially with a 450 ms inter-chunk delay to respect the public Arc Testnet RPC rate limit. Parallel chunk requests are NOT used.

**Failed ranges:** if a chunk fails (RPC error, rate limit), it is recorded as a `failedRange` and shown in the UI with a Retry button. Failed ranges do not zero out totals — the UI shows `~` to indicate incomplete data.

**Scan modes:**
- `recent`: starts from `currentHead - 300,000`. Covers approximately 1–2 days.
- `full`: starts from deployment block 67,462,931. Covers all history.
- Switching from recent to full continues scanning from where recent left off (does not rescan already-covered blocks).

**Generation counter:** each new scan clears the event list and increments a generation counter so stale async callbacks from a previous scan cannot write into a new scan's data.

**Resume:** the scanner persists `scannedTo` in state so a restart continues from the last processed block.

### 6.2 Block timestamp accuracy

`createdAt` is read from the `RequestCreated` event's block timestamp (emitted by the contract via `block.timestamp`). `paidAt` is read from the `PaymentRecorded` event's `paidAt` data field. Both are onchain values — not derived from the frontend or browser time.

---

## 7. Pending TX persistence

All pending transaction hashes are stored in sessionStorage using a compound key:

```
arc-receipt:pending:{chainId}:{contractAddress(lower)}:{account(lower)}:{action}
```

Where `action` is one of: `createRequest`, `cancelRequest`, `pay`.

**Guarantee:** a refresh during any of these operations restores the hash without resending the TX. The app waits for the original TX to confirm.

**Account isolation:** wallet A's hash is never stored under wallet B's key. Network change: the chainId is part of the key so a network switch shows no pending state for the new network.

**Clearing:** the hash is cleared from sessionStorage when the TX reaches a final state (confirmed success, confirmed revert). On RPC error, the hash is kept so the user can check the explorer.

---

## 8. USDC decimal handling

All USDC amounts use 6 decimals. Onchain amounts are `uint256` raw values (e.g., `2000000` = 2 USDC).

**`parseUsdc(str)`:** converts a decimal string to a raw `bigint`. Rejects:
- Non-string inputs
- Negative values
- Scientific notation (`1e6`)
- Hex strings (`0x...`)
- More than 6 decimal places
- Values that would exceed `uint256`

**`formatUsdc(raw)`:** converts a raw `bigint` to a human-readable string (e.g., `2000000n` → `"2.00"`).

**Rule:** all arithmetic on USDC amounts uses raw `bigint` throughout. Conversion from/to human strings happens only at UI boundaries (input/display). Never use floating-point arithmetic on USDC values.

**Cart total:** computed as `Σ parseUsdc(price) × qty` in raw bigint. No floating-point involved.

---

## 9. Chain configuration

| Setting | Value |
|---|---|
| Chain ID | 5042002 (Arc Testnet) |
| Chain name | arcTestnet (imported from viem/chains) |
| RPC providers | 4-provider fallback (see `src/config.ts`) |
| Explorer base | https://explorer.testnet.arc.io |
| Native gas | USDC (Arc's native gas IS USDC) |

All contract reads and writes are pinned to `chainId: ARC_TESTNET_ID` (5042002). A wrong-chain wallet sees a "Switch to Arc Testnet" prompt before any action.

---

## 10. Local development

```bash
# Install
bun install

# Start dev server
bun run dev

# Lint + typecheck (zero errors required before any deploy)
bash /home/user/arc-studio-helpers/check.sh

# Run contract unit tests
bun run contracts:test   # runs forge test

# Build contracts
bun run contracts:build  # runs forge build

# Production build
bunx vite build

# Copy SPA routing config into build output (required before every deploy)
cp vercel.json dist/vercel.json
```

### Files to never edit directly in the Code panel

A one-character mistake in these files crashes the entire app with a blank white screen:

| File | Why it is critical |
|------|-------------------|
| `src/onchain-money.ts` | USDC arithmetic, imported by every payment screen |
| `src/lib/contract.ts` | Contract address, ABI, topic hashes — wrong value = wrong event parsing |
| `src/lib/deployment.ts` | Deployment block — wrong value = missed or duplicate events |
| `src/lib/merchant.ts` | Merchant address config — wrong value = locked out of merchant workspace |
| `src/config.ts` | wagmi providers — broken = no RPC connection |
| `src/main.tsx` | App bootstrap — broken = blank page |

Edit them via chat (changes are validated before saving) or run the check script immediately after any direct edit.

### Diagnosing a blank white page

1. Open browser DevTools (F12) → Console tab.
2. Look for `ReferenceError` or `SyntaxError` with a file name.
3. Run `bash /home/user/arc-studio-helpers/check.sh` — shows exact error and line.
4. Describe the error in chat to fix safely.

---

## 11. Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_MERCHANT_ADDRESS` | Yes | Merchant wallet address. Comma-separated for multiple. |
| `VITE_APP_ORIGIN` | Recommended for production | Full public URL (e.g. `https://receipts.yourbusiness.com`). Used as base for QR code links and CSV export URLs. If unset, `window.location.origin` is used (correct for browser use; undefined in SSR). |

No API keys, secrets or private keys are needed for testnet. For mainnet, configure your own RPC endpoint via `src/config.ts`.

---

## 12. Deploy to Vercel

```bash
# 1. Build
bunx vite build

# 2. Copy routing config (REQUIRED — fixes /merchant and all deep links)
cp vercel.json dist/vercel.json

# 3a. Deploy via Arc Studio chat:
#     Say: "deploy this to Vercel"

# 3b. Or via Vercel CLI:
bunx vercel --prod --token YOUR_TOKEN
```

After deploying:
- **Stable alias** — updates on every deploy (use this in `VITE_APP_ORIGIN`).
- **Unique deploy URL** — permanent snapshot of this exact build.

### SPA routing fix

`vercel.json` rewrites all routes to `index.html` so React Router can handle them.
Without it, only `/` works — every other route gives a 404 on Vercel.

`public/vercel.json` is also committed so Vite copies it to `dist/` on every build.
If you still see 404s, confirm `dist/vercel.json` exists after the build.

---

## 13. Git workflow

```bash
# Current branch
git branch

# Switch to feature branch
git checkout newthing

# Stage and commit
git add -A
git commit -m "feat: describe your change"

# Push
git push origin newthing

# Create a PR (GitHub CLI)
gh pr create --base main --head newthing --title "Part 1-3 features"

# Merge only after live wallet tests pass — do not auto-merge
```

---

## 14. Known warnings and corner cases

### 14.1 Events not appearing immediately after a payment

The `use-event-history` scanner runs in chunks with a 450 ms inter-chunk delay.
A just-paid event may not appear in Reports/Today for up to a few seconds while the
scanner reaches that block range. The `getMerchantRequests` contract read (used for
Awaiting count and Orders list) reflects live state immediately.

### 14.2 Cancel status lost on refresh (partially fixed in Stage 1)

After Stage 1, the cancel TX hash is persisted and restored on refresh. The
"Cancelling…" banner is restored. However, the specific `cancellingId` (which
row is being cancelled) is NOT persisted — the row cancel indicator is not
shown during a restored session, but the dashboard-level "Cancelling…" banner
is shown correctly via the restored hash.

### 14.3 Full history scan takes several minutes

Scanning 65M blocks on Arc Testnet at 2,000 blocks/chunk with a 450 ms delay
takes approximately 4–8 minutes. Progress is shown. The scan is not required for
normal operation — recent mode covers ~1–2 days and is sufficient for daily use.

### 14.4 Receipt TX recovery may not find the hash if RPC is rate-limited

`PublicReceipt` searches for the `PaymentRecorded` event starting from deployment
block. If the RPC rate-limits heavily during recovery, some chunks may fail silently
(they are retried once; on second failure the chunk is skipped). The receipt still
renders without the TX link — the fallback shows a link to all contract events on
the explorer.

### 14.5 Menu data is session-scoped

Menu items and prices are in `sessionStorage`, not `localStorage`. They survive
tab refreshes but NOT full browser restarts, private/incognito windows, or
device changes. If you need persistent menu data across sessions, use the
Settings screen to re-enter items on each session or update the code to use
`localStorage` instead.

### 14.6 Replacement / speed-up transactions

If a wallet speeds up or replaces a payment TX with a new nonce, the original TX
is replaced. If the new TX:
- Contains the correct `PaymentRecorded` event → checkout shows "Payment confirmed".
- Does NOT contain `PaymentRecorded` → checkout shows "Payment outcome unclear" with an explorer link. Contract state is re-read — if `status=1 (Paid)`, the customer is told no further action is needed.

The merchant should verify the contract state before assuming non-payment.

### 14.7 Equal-total orders

Two carts with the same total (e.g. both = 5.00 USDC) produce different request IDs.
The contract auto-increments a global counter — equal totals never produce the same ID.
The frontend never identifies orders by amount alone.

### 14.8 Brave Shields / strict content blocking

Brave Shields can block the Arc Testnet RPC endpoints. Symptoms: spinner stuck on
"Loading verified details from Arc Testnet…", or "Could not load request #N".
Fix: allow the site in Brave Shields, or disable Shields for this domain.

### 14.9 Testnet vs mainnet

The app is **testnet only** as deployed. USDC on Arc Testnet is not real money.
All contract addresses, chain IDs and RPC URLs are Arc Testnet.
For mainnet deployment, see `PENDING.md` — a mainnet config change, independent
security audit, and separate deployment are required.

### 14.10 `VITE_APP_ORIGIN` and QR codes

If `VITE_APP_ORIGIN` is not set, QR codes and payment links use `window.location.origin`.
This is correct for browser-rendered apps. If you server-side render or generate links
outside the browser, set `VITE_APP_ORIGIN` to the deployed domain.

Changing the Vercel URL does NOT break existing QR codes — but those QR codes
contain the old URL. Customers with already-shared QR codes for an old URL
can still enter the request ID manually at `/verify`.

### 14.11 UTC midnight rollover

Today/Reports use UTC time. "Today" means 00:00:00 UTC to 23:59:59 UTC.
In India (IST = UTC+5:30), this means:
- UTC midnight = 05:30 IST
- Stats auto-refresh at midnight UTC via a 60-second tick + visibility change event.

### 14.12 Cart data not shared across merchant devices

The cart and menu are in sessionStorage — they exist only in the current browser tab.
If the merchant uses two devices (e.g. phone + tablet), each has its own cart.
Orders created on one device appear in the Orders list on both (they are onchain),
but the cart state on each device is independent.

---

## 15. Production readiness checklist

Before deploying to production (mainnet or a permanent testnet URL):

- [ ] Set `VITE_MERCHANT_ADDRESS` to the production merchant wallet.
- [ ] Set `VITE_APP_ORIGIN` to the production URL (e.g. `https://receipts.yourdomain.com`).
- [ ] Run `bash /home/user/arc-studio-helpers/check.sh` — zero errors required.
- [ ] Run `bunx vite build` — zero errors required.
- [ ] Copy `vercel.json` to `dist/` before deploying.
- [ ] Test: open `/pay/:id` from a fresh browser (no wallet) — should show the correct amount from contract.
- [ ] Test: complete a payment from a second wallet — receipt shows correct payer address.
- [ ] Test: refresh during payment confirmation — pending state restores, no second TX sent.
- [ ] Test: open `/receipt/:id` in a fresh browser — TX hash is recovered without wallet.
- [ ] Test: navigate from one receipt to another — hash does not carry over.
- [ ] Test: `/merchant/orders/:id` when connected as a different merchant — read-only mode shown.
- [ ] Test: orders created on one session appear in a new browser session (they are onchain).
- [ ] Confirm contract address in `src/lib/contract.ts` matches the intended deployment.
- [ ] Confirm deployment block in `src/lib/deployment.ts` is correct (used as getLogs start block).
- [ ] For mainnet: obtain an independent security audit of the Solidity contract before handling real funds.

---

## 16. Rate limit and RPC errors

The public Arc Testnet RPC has a rate limit. The scanner handles this automatically:
- Calls are serialised within each chunk (not parallel).
- 450 ms inter-chunk delay prevents hitting the limit.
- Failed chunks are automatically retried up to 3 times.
- If a range fails permanently, it appears in Reports with a Retry button.

If you see frequent `429` or connection errors in the Tracing panel:
- Wait a few minutes and click Retry on failed ranges.
- The app will not lose data — it will resume from the last successfully scanned block.
- For high-traffic production use, configure a private RPC endpoint in `src/config.ts`.

---

## 17. Q&A

**Q: The app shows a completely blank white page.**
A: JavaScript syntax error in a core file. Open DevTools → Console tab. Run the check script. Fix the error described. Never edit core files directly.

**Q: `/merchant` gives a 404 on Vercel.**
A: `vercel.json` was not copied to `dist/`. Run `cp vercel.json dist/vercel.json` then redeploy.

**Q: I changed the Vercel URL — do I need to update anything?**
A: No — QR codes use `window.location.origin` automatically. Old QR codes with the old URL still work if the old deployment is still live.

**Q: The scan shows "totals incomplete / some records may be missing".**
A: Normal during first load. Wait for the scan to finish. Click Retry on any failed ranges.

**Q: A customer says the payment link is broken.**
A: Check that the request has not expired. The customer can also type the request ID at `/verify`.

**Q: I want to use a custom domain.**
A: Add the domain in Vercel → Settings → Domains. Then set `VITE_APP_ORIGIN=https://yourdomain.com` in `.env`, rebuild, and redeploy.

**Q: Cart is empty after a browser restart.**
A: Cart drafts are in sessionStorage and do not survive browser restarts. This is intentional — submitted orders are permanent onchain, but unsent drafts are transient. Rebuild the cart from the menu.

**Q: git push says "Everything up to date" but I made changes.**
A: `git add -A && git commit -m "message" && git push origin newthing`

**Q: git merge fails with "local changes would be overwritten".**
A: `git add -A && git commit -m "fix: commit before merge"` then retry.
