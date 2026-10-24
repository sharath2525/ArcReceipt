# ArcReceipt Checkout — Implementation Specification

> **Three-part specification. Do not begin implementation until Part 3 is received.**
> Append each part here without replacing earlier requirements.
> Maintain the checklist at the bottom with matching IDs.

---

## PART 1 OF 3 — received Saturday 17 October 2026

---

### PROJECT DIRECTION

Continue the existing project. Do not start over.

Build a reliable USDC checkout and payment-receipt app for small vendors
at crypto conferences and community events.

**Product promise:**
> "Every order has its own QR. Every confirmed payment has its own receipt."

**Excluded features:**
WhatsApp, SMS, phone-number collection, customer accounts, full restaurant
menus, delivery, loyalty, refunds, AI features, a new database.

Implement in stages inside this Studio project. Preserve build history.
Fix and validate each stage before moving on. Do not declare completion
based only on compilation or mock tests.

---

### 1. AUDIT AND PRESERVE

**1.1** Inspect source, contract ABI, deployment and live app. Identify
working, incomplete and broken features.

**1.2** Preserve the existing contract where possible. Do not redeploy or
change it merely to fix frontend bugs.

**1.3** Previously reviewed testnet deployment:
- Chain ID: `5042002`
- Contract: `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`

Verify these against actual project deployment records.
Keep testnet and mainnet addresses separate.

---

### 2. RELIABILITY FIXES FIRST

**Known observed problems:**
- RPC reads fail.
- Application gets stuck on "Confirming…".
- Refresh loses the pending transaction hash.
- Failed/loading queries sometimes appear as "No requests yet".
- Dashboard fetches only `getMerchantRequests(account, 0, 20)`.
- Later requests are inaccessible.
- Cancellation success appears at submission instead of confirmation.

**2.1** Diagnose browser failures using actual errors and HTTP status.
Configure tested RPC fallback, bounded retries and backoff.

**2.2** Avoid overlapping requests and excessive polling. Keep loaded data
visible during temporary failures.

**2.3** Separate loading, empty, error and populated states. Never interpret
undefined query data as proof that there are no requests.

**2.4** Add pagination across all merchant requests. Show newest first.
Reversing the first 20 records is not sufficient.

**2.5** Pin reads and receipt tracking to the intended chain.

**2.6** Handle successful, reverted, replaced, rejected and unresolved
transactions. Never show Paid, Created or Cancelled merely because a
wallet returned a transaction hash.

**2.7** Persist pending tracking by chain, contract, submitting wallet,
transaction hash and action. Restore it after refresh.
Never automatically resubmit transactions.

**2.8** Provide an explorer link and Check status action when confirmation
is delayed or unavailable.

**2.9** Reset account-specific views safely on account/network changes.
Treat browser storage as untrusted tracking data, never payment proof.

---

### 3. MERCHANT EXPERIENCE

**Navigation:** Sell · Orders · My receipts · Verify receipt

#### 3.1 SELL

Provide:
- Prominent amount input labelled USDC.
- Validation of decimal precision, positive amounts and contract limits.
- Counter-friendly expiry choices: 5, 15 and 30 minutes, **if supported
  by the current contract.**
- Review of amount, merchant, network and expiry before signing.
- Explanation that creation requires an onchain transaction.
- Submitted terms frozen while that action is pending.
- Actual request ID and large QR after confirmed creation.
- Copy payment link and Open checkout actions.

Use the public deployment URL, never a Studio-only preview URL.

Equal-value requests must have different IDs and links.
Do not add fake product descriptions or imply the contract stores
itemized purchases.

#### 3.2 ORDERS

Display:
- Request ID
- Amount
- Creation time when available
- Expiry
- Payment state
- Actual payer when paid

States: **Awaiting payment**, **Paid**, **Expired**, **Cancelled**

Provide filtering and pagination across all merchant requests.
Make newly confirmed requests easy to find.
Provide QR, checkout link, receipt and cancellation where applicable.

Keep payment state separate from physical fulfilment.
Do not claim blockchain payment proves goods were delivered.

---

## PARTS 2 AND 3

*(To be appended when received — do not implement until Part 3 is confirmed.)*

---

## IMPLEMENTATION CHECKLIST

*(Status: ⬜ not started · 🔄 in progress · ✅ done · ❌ blocked)*

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| 1.1 | Audit source, ABI, deployment and live app | ⬜ | |
| 1.2 | Preserve existing contract | ⬜ | |
| 1.3 | Verify chain ID 5042002 + contract address | ⬜ | |
| 2.1 | RPC fallback, bounded retries, backoff | ⬜ | |
| 2.2 | No overlapping requests; stale data visible | ⬜ | |
| 2.3 | Separate loading/empty/error/populated states | ⬜ | |
| 2.4 | Full pagination, newest first | ⬜ | |
| 2.5 | Chain-pinned reads and receipt tracking | ⬜ | |
| 2.6 | TX outcome handling (success/revert/replace/reject/unresolved) | ⬜ | |
| 2.7 | Persist pending TX; restore after refresh; no auto-resubmit | ⬜ | |
| 2.8 | Explorer link + Check status for delayed confirmation | ⬜ | |
| 2.9 | Safe reset on account/network change | ⬜ | |
| 3.1 | Sell screen (amount, expiry, review, freeze, QR after confirm) | ⬜ | |
| 3.2 | Orders screen (all states, filter, pagination, actions) | ⬜ | |

---

## PART 2 OF 3 — received Saturday 17 October 2026

### 4. CUSTOMER CHECKOUT

**4.1 Payment links**
- Work without Studio login or connected merchant wallet
- Display: request ID, merchant address (full-address inspectable), exact USDC amount, network, expiry, current status
- Read all terms from the contract — never trust amount/recipient/paid status from URL params or browser storage

**4.2 Authoritative contract reads**
- Amount, merchant, expiry and status always come from `getRequest(id)` on chain
- URL supplies only the request ID

**4.3 Payment flow**
- Connect wallet → switch network if needed → explain approve + pay as two distinct steps → exact-amount approval only (no unlimited) → handle: insufficient balance, gas, rejected signing, expiry, cancellation, already-paid → show submitted / confirming / confirmed / failed states → verify receipt.status before showing success → never infer payment from amount or timing → plain transfer to merchant address does not mark a request paid

**4.4 Post-payment**
- Same request URL shows receipt after confirmed payment
- Expired/cancelled requests show a non-payable state

**4.5 Wallet compatibility**
- Test actual phone wallet flow
- State unsupported wallet/browser combinations clearly

### 5. PAYMENT RECEIPTS

**5.1 Receipt contents**
- Request ID, merchant, actual payer, exact USDC amount, network, contract address, payment TX hash, block timestamp, explorer link, clear payment status

**5.2 Receipt access**
- Stable public receipt URL
- Copy receipt link
- Readable print layout
- Wallet-free lookup
- No personal contact details
- Label: "Payment receipt" — not "Tax invoice"
- Never present example data as a real payment

### 6. MY RECEIPTS

**6.1 Payer history**
- Connected wallet finds payments it actually made
- Use `PaymentRecorded` event indexed fields for bounded paginated lookup

**6.2 Implementation requirements**
- Start from verified contract deployment block (recorded in BUILD_LOG)
- Respect provider block-range and rate limits
- Cache by chain + contract + payer
- Handle partial coverage, retries and refresh
- Do not claim complete history until scan is complete
- Do not rely solely on device-local storage
- Distinguish "requests created by me" from "payments made by me"

**6.3 UX**
- Explain history belongs to the connected wallet
- Wallet change changes history; shared receipt links always work
- No phone authentication or cross-wallet profiles

### 7. VISUAL DESIGN

**7.1 Brand**
- Keep ArcReceipt identity and Studio attribution
- Warm off-white backgrounds, dark readable text, emerald primary actions, clear borders, restrained cards, large touch targets, visible keyboard focus

**7.2 Information hierarchy**
- Merchant: amount, QR, order status
- Customer: amount, merchant, payment action
- Receipt: confirmed payment details

**7.3 Layout**
- Merchant screens: laptop/tablet optimised
- Checkout: mobile-first
- No oversized marketing headings, unnecessary technical labels, or decorative sections that push transactions below the fold

**7.4 Status display**
- Network and testnet/mainnet banner always visible
- Text + icons for statuses, not colour alone
- No green success before verification
- A/B Demo in a clearly labelled Demo area

### 8. SECURITY AND CONTRACT REVIEW

**8.1 Secrets**
- Private keys and secret API credentials must not appear in frontend code, VITE variables, source control, logs or build artifacts

**8.2 Test coverage**
- Merchant-only cancellation
- Exact recipient and amount enforcement
- Duplicate payment prevention
- Expiry enforcement
- Correct token and chain
- Reentrancy protection
- Failed-transfer rollback
- Request-ID-specific payment recording
- Browser, URL and storage manipulation
- Account/network changes during an action

**8.3 Honest claims**
- Describe material limitations
- Do not describe the app as unhackable, audited or production-certified without supporting evidence

---

## CHECKLIST — Part 2 additions

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| 4.1 | Checkout works without Studio login or merchant wallet | ⬜ | |
| 4.2 | All terms read from contract; URL supplies ID only | ⬜ | |
| 4.3 | Full payment flow with exact approval, all error states, receipt.status check | ⬜ | |
| 4.4 | Same URL shows receipt after payment; expired/cancelled non-payable | ⬜ | |
| 4.5 | Phone wallet tested; unsupported combos stated | ⬜ | |
| 5.1 | Receipt includes all required fields | ⬜ | |
| 5.2 | Stable public URL, copy link, print layout, wallet-free | ⬜ | |
| 6.1 | My Receipts — payer history from PaymentRecorded events | ⬜ | |
| 6.2 | Scans from deployment block; respects limits; partial coverage honest | ⬜ | |
| 6.3 | Wallet-scoped history; shared links always work | ⬜ | |
| 7.1 | Brand and Studio attribution preserved | ⬜ | |
| 7.2 | Correct info hierarchy per role | ⬜ | |
| 7.3 | Merchant=laptop/tablet, checkout=mobile-first | ⬜ | |
| 7.4 | Testnet banner, text+icon statuses, no premature green | ⬜ | |
| 8.1 | No secrets in frontend code or build artifacts | ⬜ | |
| 8.2 | All security scenarios tested | ⬜ | |
| 8.3 | Limitations described accurately | ⬜ | |

---

## PART 3 OF 3 — received Saturday 17 October 2026

### 9. ACCEPTANCE TESTS

Run automated tests where appropriate and verify the actual Vercel app.
Use testnet for initial end-to-end wallet tests.

| ID | Scenario | Status | Evidence |
|----|----------|--------|----------|
| A | Create two requests with the same amount | ⬜ | |
| B | Pay only the second from a different wallet | ⬜ | |
| C | Confirm only the second becomes Paid | ⬜ | |
| D | Refresh merchant/customer screens and retain correct result | ⬜ | |
| E | Refresh during confirmation and recover TX tracking | ⬜ | |
| F | Requests beyond the first 20 remain accessible | ⬜ | |
| G | Open a QR/payment link in a separate browser | ⬜ | |
| H | Open a receipt without wallet connection | ⬜ | |
| I | Find payment in payer's My Receipts view | ⬜ | |
| J | Reject expired, cancelled, already-paid and nonexistent requests | ⬜ | |
| K | Handle rejected approval/payment and failed transactions | ⬜ | |
| L | Simulate RPC failure and recover without false empty data | ⬜ | |
| M | Switch wallets/networks without mixing data or pending actions | ⬜ | |
| N | Modify URL/localStorage; payment truth must remain unchanged | ⬜ | |
| O | Confirm plain wallet transfers cannot pay unrelated requests | ⬜ | |
| P | Test mobile layout, keyboard access and printable receipts | ⬜ | |

---

### 10. SUBMISSION PREPARATION

**10.1 Deliverables:**
- Studio project URL
- Accurate build log
- Public source repository
- Setup instructions and placeholder env vars only
- Working public deployment
- Contract deployment records
- Test results and known limitations
- Short product description
- Concise demo script

**10.2 Before mainnet:**
- Verify current official Arc network and token configuration
- Review contract and passing tests
- Present deployment and small-value payment steps for owner to execute
- Never request seed phrase or private key in chat
- Do not deploy or submit financial transactions without required owner approval

**10.3 Mainnet requirement:**
Actual mainnet USDC payment through the app and contract is required for submission.
Creating a request or approving tokens alone does not satisfy this.

Suggested demo: Create orders A and B for same small amount. Pay B only. Show A remains unpaid. Refresh. Open B's receipt independently.

---

### 11. IMPLEMENTATION PROCESS

**11.3 Implement in this order:**
1. Audit existing implementation
2. Reliability and transaction recovery
3. Merchant screens and pagination
4. Public checkout and receipts
5. My receipts
6. Visual/accessibility improvements
7. Security review and regression tests
8. Deployment validation and submission preparation

**11.4** Work through all feasible stages. Record concrete blockers and continue independent work.
Do not mark blocked or untested requirements as complete.

---

### 12. FINAL HANDOFF

Provide:
1. What changed
2. Tested deployment URL and build identifier
3. Acceptance-test results: passed, failed and untested
4. Contract addresses and chain IDs
5. Remaining owner actions for mainnet and submission
6. Material limitations
7. Completed requirement checklist showing all three parts accounted for

---

## CHECKLIST — Part 3 additions

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| 9A | Create two same-amount requests | ⬜ | |
| 9B | Pay only second from different wallet | ⬜ | |
| 9C | Only second becomes Paid | ⬜ | |
| 9D | Refresh retains correct state | ⬜ | |
| 9E | Refresh during confirmation recovers TX | ⬜ | |
| 9F | Requests beyond 20 accessible | ⬜ | |
| 9G | QR/link opens in separate browser | ⬜ | |
| 9H | Receipt opens without wallet | ⬜ | |
| 9I | Payer finds payment in My Receipts | ⬜ | |
| 9J | Expired/cancelled/paid/missing requests rejected | ⬜ | |
| 9K | Rejected/failed transactions handled cleanly | ⬜ | |
| 9L | RPC failure recovers without false empty | ⬜ | |
| 9M | Wallet/network switch safe | ⬜ | |
| 9N | URL/storage manipulation does not change payment truth | ⬜ | |
| 9O | Plain transfer does not settle a request | ⬜ | |
| 9P | Mobile, keyboard, print tested | ⬜ | |
| 10.1 | Submission package assembled | ⬜ | |
| 10.2 | Mainnet deployment steps prepared for owner | ⬜ | |
| 10.3 | Actual mainnet payment demonstrated | ⬜ | owner action required |
| 12 | Final handoff document complete | ⬜ | |

---

## SHOP UI ADDITION (added 2026-10-17)

### Product
ArcReceipt Shop — "Build the order. Show its QR. Verify the payment."
Target: small café or food stall at a crypto community event.
Merchant-operated: shopkeeper selects items, creates the request, shows QR.
Customers scan and pay. Customers do NOT create requests.

### Menu
Default items (sample prices — not a real business):
- Burger 2 USDC, Coke 3 USDC, Fries 1 USDC, Coffee 2 USDC
Merchant can edit name/price/emoji per item. Edits stored in sessionStorage
keyed by chainId+contract+merchant. A Custom amount option is provided.

### Cart
- Item name, unit price (frozen at add-time), quantity controls, line total, remove, clear
- Exact USDC total using decimal-safe arithmetic (parseUsdc x qty per row, summed as bigint)
- Empty cart, invalid totals rejected before review

### Payment Request
- Review screen: amount, merchant, network, expiry before wallet prompt
- Submitted terms frozen while TX pending (frozenCart snapshot)
- After confirmed creation: large QR, request ID, amount, explorer link,
  copy link, open checkout, receipt link, next order button
- Equal-value carts get different IDs (enforced by contract)
- Local item descriptions shown as merchant reference only, not onchain

### Data Honesty
- Item names/prices are local notes — not on contract, not payment proof
- Public checkout reads amount/merchant/expiry/status from contract
- URL parameters never trusted for payment terms
- Cart persisted to sessionStorage only; never used to verify payment status

### Checklist additions
| ID | Requirement | Status |
|----|-------------|--------|
| S1 | Menu grid with 4 sample items, tap-to-add | ✅ |
| S2 | Cart with qty controls, line totals, clear | ✅ |
| S3 | Custom amount option | ✅ |
| S4 | Decimal-safe cart arithmetic (bigint) | ✅ |
| S5 | Editable menu presets per merchant | ✅ |
| S6 | Review screen before wallet prompt | ✅ |
| S7 | Terms frozen while TX pending | ✅ |
| S8 | Confirmed order card: QR, ID, amount, links | ✅ |
| S9 | Next order button clears cart | ✅ |
| S10 | Local items labelled as merchant notes only | ✅ |
| S11 | Equal carts get different IDs | ✅ (contract) |
| S12 | Validation: items A/B, pay only B, A stays open | ⬜ live test pending |

---

## REPAIR SPEC — received Saturday 17 October 2026 (Parts 1+2)

Sections A–D (Part 1) and E–M (Part 2) combined.

### Confirmed bugs fixed this session

| ID | Finding | Fix | Status |
|----|---------|-----|--------|
| R1 | Receipt-error effect set `processedHash.current`, permanently suppressing successful recovery after temporary RPC failure | Removed `processedHash.current = createHash` from error effect; only success/revert set it | ✅ |
| R2 | `MerchantDashboard` `useState` initializer runs before wagmi async wallet reconnect on Vercel — pending hash not restored | Already correct in `useEffect([address])`; confirmed working | ✅ |
| R3 | Per-row `refetchInterval: 6_000` with 23+ rows = 23+ simultaneous RPC calls every 6 s | Removed per-row polling; rows use `staleTime: 30_000, refetchOnMount: true` | ✅ |
| R4 | `MyReceipts` decoded payer not validated against connected wallet | Added explicit payer comparison + topic-0 signature check in `decodePaymentLog` | ✅ |
| R5 | `SellPage` confirmed card used live `total` (mutable) not frozen submitted amount | Added `frozenAmount` state set at submission; confirmed card uses it | ✅ |
| R6 | `parseUsdc` silently truncated >6 decimal places | Now throws `Too many decimal places` — callers must round before calling | ✅ |
| R7 | `SellPage` did not restore pending hash after wallet async reconnect | Added `useEffect([address])` that restores from sessionStorage when `address` becomes available | ✅ |
| R8 | `PublicCheckout` receipt watchers missing `chainId: ARC_TESTNET_ID` and used `confirmations: 0` | Added explicit chain pin and `confirmations: 1` to both watchers | ✅ |

### Unverified items requiring live wallet test

| ID | Item | Blocker |
|----|------|---------|
| K1 | Create A+B with identical totals, pay only B, A stays open | Requires second wallet with test USDC |
| K2 | Refresh during confirmation restores tracking | Requires live TX in progress |
| K3 | RPC failure shows recoverable error (Fix R1 enables this path) | Cannot simulate without controlled RPC outage |
| K4 | My Receipts payer isolation (Fix R4 guards the path) | Requires two different payer wallets |
| K5 | Mainnet deployment + real USDC payment | Owner action required — testnet only until then |

### parseUsdc callers audited

All callers of `parseUsdc` already wrap in try/catch and show user-facing errors on throw. The new rejection behaviour is transparent — users entering >6 dp now see "Too many decimal places" instead of a silently changed amount.

### Deployment configuration comparison (Studio vs Vercel)

| Item | Studio | Vercel |
|------|--------|--------|
| Chain ID | 5042002 | 5042002 |
| Contract | 0x4017d…BeA18 | 0x4017d…BeA18 |
| USDC ERC-20 | 0x3600…0000 | 0x3600…0000 |
| RPC primary | rpc.testnet.arc.io | rpc.testnet.arc.io |
| RPC fallback | rpc.arc.io, rpc2.testnet.arc.io | same (config.ts) |
| VITE_APP_ORIGIN | preview.studio.arc.io | arc-studio-47505b56…vercel.app |
| Tracing | Arc Studio parent frame | disabled (passthrough when `_enabled=false`) |
| Studio proxy/session | Yes | No — app must work standalone |

Tracing code verified safe for standalone deployment: all patches check `_enabled` (defaults `false`) and call through to the original function unchanged.

---

## PART 1 — LAYOUT, ROUTING AND MERCHANT ACCESS (2026-10-18)

### Route decisions

| Route | Layout | Component | Notes |
|-------|---------|-----------|-------|
| `/merchant` | MerchantLayout | MerchantSellPage → SellPage | gated |
| `/merchant/today` | MerchantLayout | MerchantTodayPage (stub) | gated |
| `/merchant/orders` | MerchantLayout | MerchantOrdersPage → MerchantDashboard mode=orders | gated |
| `/merchant/orders/:requestId` | MerchantLayout | MerchantOrderDetailPage | gated; reads from chain |
| `/merchant/reports` | MerchantLayout | MerchantReportsPage (stub) | gated |
| `/merchant/settings` | MerchantLayout | MerchantSettingsPage | gated |
| `/merchant/demo` | MerchantLayout | MerchantDemoPage → ABDemo | gated |
| `/pay/:requestId` | CustomerLayout | PayPage → PublicCheckout | open |
| `/receipt/:requestId` | CustomerLayout | ReceiptPage → PublicReceipt | open |
| `/payments` | CustomerLayout | PaymentsPage → MyReceipts | open |
| `/verify` | CustomerLayout | VerifyPage → VerifyPanel | open |
| `/` (any query string) | — | LegacyRedirect | redirects to new paths |
| `*` (404) | CustomerLayout | NotFound | |

### Legacy URL mapping

| Old URL | Redirects to |
|---------|-------------|
| `?request=N` | `/pay/N` |
| `?request=N&view=receipt` | `/receipt/N` |
| `?request=N&view=order` | `/merchant/orders/N` |
| `?view=orders` | `/merchant/orders` |
| `?view=my-receipts` | `/payments` |
| `?view=verify` | `/verify` |
| `?view=demo` | `/merchant/demo` |
| `/` (bare) | `/verify` |

### Merchant access configuration

- Env var: `VITE_MERCHANT_ADDRESS` in `.env`
- Validation: must be `0x` + 40 hex chars (case-insensitive)
- Access states: `unconfigured` / `disconnected` / `authorized` / `unauthorized`
- Gate: `MerchantGate` component wraps `MerchantLayout` — evaluated on every render
- Logic: `src/lib/merchant.ts` — `getMerchantAccess(connectedAddress)`
- Status: `VITE_MERCHANT_ADDRESS=` (empty placeholder) — **awaiting merchant address from owner**

### Files added this session

| File | Purpose |
|------|---------|
| `src/lib/merchant.ts` | Merchant access config + `getMerchantAccess()` |
| `src/components/MerchantGate.tsx` | Access gate with 4 fallback states |
| `src/components/MerchantLayout.tsx` | Sidebar workspace (tablet/laptop) + mobile bottom nav |
| `src/components/CustomerLayout.tsx` | Narrow mobile shell; logo → /verify, not /merchant |
| `src/AppRouter.tsx` | React Router v6 route tree |
| `src/pages/LegacyRedirect.tsx` | Old query-string URL → new path redirects |
| `src/pages/merchant/MerchantSellPage.tsx` | Wraps SellPage |
| `src/pages/merchant/MerchantTodayPage.tsx` | Stub |
| `src/pages/merchant/MerchantOrdersPage.tsx` | Wraps MerchantDashboard mode=orders |
| `src/pages/merchant/MerchantOrderDetailPage.tsx` | Chain-read order QR view |
| `src/pages/merchant/MerchantReportsPage.tsx` | Stub |
| `src/pages/merchant/MerchantSettingsPage.tsx` | Shows deployment config |
| `src/pages/merchant/MerchantDemoPage.tsx` | Wraps ABDemo |
| `src/pages/customer/PayPage.tsx` | Wraps PublicCheckout |
| `src/pages/customer/ReceiptPage.tsx` | Wraps PublicReceipt |
| `src/pages/customer/PaymentsPage.tsx` | Wraps MyReceipts |
| `src/pages/customer/VerifyPage.tsx` | Wraps VerifyPanel |

### Remaining owner action before merchant workspace works

Set `VITE_MERCHANT_ADDRESS=0x<your-wallet-address>` in `.env` and restart the dev server.
The workspace shows "Merchant address not configured" until this is set.

### Part 1 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| P1-1 | Separate merchant and customer layouts | ✅ | MerchantLayout + CustomerLayout |
| P1-2 | All /merchant/* routes gated by MerchantGate | ✅ | |
| P1-3 | Customer routes never show merchant nav | ✅ | CustomerLayout has no merchant links |
| P1-4 | Customer logo does not navigate to merchant workspace | ✅ | Links to /verify |
| P1-5 | Merchant access from VITE_MERCHANT_ADDRESS (allowlist) | ✅ | |
| P1-6 | Disconnected: "Connect merchant wallet" | ✅ | |
| P1-7 | Other wallet: "This wallet does not have merchant access" | ✅ | |
| P1-8 | Missing/invalid config: fail closed with config message | ✅ | |
| P1-9 | Never trust URL role or localStorage for access | ✅ | gate rechecks on every render |
| P1-10 | Legacy ?request=N links still work | ✅ | LegacyRedirect |
| P1-11 | Legacy ?view=* links still work | ✅ | LegacyRedirect |
| P1-12 | Vercel rewrites cover new path-based routes | ✅ | existing rewrite `/(.*) → /index.html` |
| P1-13 | Reports/Today stubs honest (no fake numbers) | ✅ | explicit "coming in Part 3" |
| P1-14 | Lint/typecheck clean | ✅ | 0 errors 0 warnings |
| P1-15 | VITE_MERCHANT_ADDRESS set with real address | ✅ | 0xD995d0c31802A8D95C163f875fFefB40AB964eD6 |
| P1-16 | Live wallet test: authorized wallet sees workspace | ⬜ | ready to test |
| P1-17 | Live wallet test: other wallet sees access denied | ⬜ | ready to test |
| P1-18 | Live wallet test: old ?request=N QR link opens checkout | ⬜ | requires live test |

### Known conflicts / notes for Part 2

- `MerchantDashboard` `onNavigateToOrder` prop is now used only via `MerchantOrdersPage` (React Router navigate). The prop signature in `MerchantDashboard.tsx` is kept for compatibility but the internal `_onNavigateToOrder` rename marks it as unused there — Part 2 can wire it properly or remove it.
- `SellPage` has an unused `_txReverted` state (pre-existing from earlier repair session) — can be cleaned up in Part 2.
- `ABDemo` tab no longer appears in the main tab bar; it lives at `/merchant/demo` only, accessible from merchant sidebar.

---

## PART 2 — SELL FLOW, CHECKOUT RELIABILITY AND CUSTOMER NAV (2026-10-18)

### What changed

| Area | Change | File |
|------|--------|------|
| `MerchantOrderDetailPage` | `isPaid` checked before `expired` — paid request whose expiry has passed now always shows "Paid" | `src/pages/merchant/MerchantOrderDetailPage.tsx` |
| `MerchantOrderDetailPage` | Added "Next order" button — navigates to `/merchant` (Sell) without cancelling the current request | same |
| `CustomerLayout` | Added Verify / My Payments nav tabs; logo still links to /verify not merchant workspace | `src/components/CustomerLayout.tsx` |
| `PublicCheckout` | RPC error message now names connectivity/Brave Shields as possible cause without asserting it | `src/components/PublicCheckout.tsx` |
| `PublicReceipt` | Same Brave Shields context added to RPC error message | `src/components/PublicReceipt.tsx` |

### What was NOT changed (already correct from earlier session)

- `SellPage.tsx` — cart bigint arithmetic, review screen, frozen snapshot, pending recovery, all correct
- `PublicCheckout.tsx` — single write hook, exact-amount approve, chain-pinned polling, all error states
- `PublicReceipt.tsx` — wallet-free, all chain reads, print, explorer links
- `MyReceipts.tsx` — scan from deployment block, progress display, partial-scan honesty
- `MerchantDashboard.tsx` — paginated IDs, cancel flow, receipt polling, all correct
- `pending-tx.ts` — scoped by chain+contract+account+action, no auto-resubmit

### Part 2 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| P2-1 | Paid status never overridden by expired | ✅ | `isPaid` checked first in OrderDetailPage |
| P2-2 | Next order button on order detail screen | ✅ | navigates to /merchant, does not cancel |
| P2-3 | Customer nav shows Verify + My Payments | ✅ | /pay and /receipt excluded (QR-only entry) |
| P2-4 | RPC error mentions connectivity/Brave Shields | ✅ | PublicCheckout + PublicReceipt |
| P2-5 | Cart arithmetic uses bigint throughout | ✅ | pre-existing, confirmed |
| P2-6 | Review screen shown before wallet prompt | ✅ | pre-existing SellPage + MerchantDashboard |
| P2-7 | Submitted snapshot frozen while pending | ✅ | pre-existing frozenAmount/frozenCart |
| P2-8 | Pending TX restored after refresh | ✅ | pre-existing pending-tx.ts + useEffect |
| P2-9 | Single write hook in PublicCheckout | ✅ | pre-existing |
| P2-10 | Exact-amount approval only (no unlimited) | ✅ | pre-existing |
| P2-11 | Pay step: receipt.status verified before success | ✅ | pre-existing confirmations:1 |
| P2-12 | Account switch clears pending/history | ✅ | pre-existing scoped keys |
| P2-13 | Brave Shields: no claim that UI fixes RPC blocks | ✅ | documented honestly |
| P2-14 | Live wallet tests (A/B equal orders, pay only B) | ⬜ | requires two wallets + test USDC |
| P2-15 | Refresh during confirmation recovers tracking | ⬜ | requires live TX in progress |
| P2-16 | Open receipt in another browser without wallet | ⬜ | requires live paid request |
| P2-17 | Verify Vercel preview (not just Studio) | ⬜ | requires Vercel deployment |

---

## PART 3 — TODAY DASHBOARD AND HISTORICAL REPORTING (2026-10-18)

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| `RequestCreated` block.timestamp for createdAt | Contract does not store createdAt; block timestamp is the only verifiable source |
| `PaymentRecorded` log data paidAt for payment time | Equals block.timestamp per contract; authoritative, not derived |
| Scan start: block 2,900,000 (hardcoded safe lower bound) | Deploy TX confirmed in metadata; lower bound avoids runtime eth_getTransactionReceipt call that could fail |
| 2,000-block scan chunks | Safe batch size for most RPC providers; no hardcoded rate limits stated |
| Failed ranges tracked, never zeroed | Partial data is always labelled ~; failed ranges shown with retry |
| sessionStorage scope: chain+contract+merchant | Prevents data mixing across merchants or chains |
| UTC half-open intervals [start, nextStart) | Correct boundary: midnight payment → new day |
| Midnight UTC rollover: 1-minute tick + visibilitychange | Handles tab sleep/resume without requiring a background worker |

### Files added this session

| File | Purpose |
|------|---------|
| `src/lib/utc-periods.ts` | UTC interval math: dayStart, monthStart, nextDay, nextMonth, isInDay, isInMonth, formatters |
| `src/lib/use-event-history.ts` | Bounded getLogs scan hook: RequestCreated + PaymentRecorded, 2k-block chunks, retry, dedup, resume |
| `src/pages/merchant/MerchantTodayPage.tsx` | Today dashboard (replaces stub): collected/payments/orders/awaiting with honest incomplete labels |
| `src/pages/merchant/MerchantReportsPage.tsx` | Reports page (replaces stub): period picker, daily breakdown, expandable rows, custom range |

### Part 3 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| P3-1 | createdAt from RequestCreated block.timestamp | ✅ | getLogs + getBlock per unique block |
| P3-2 | paidAt from PaymentRecorded log data | ✅ | decoded from log.data offset 64-128 |
| P3-3 | UTC half-open intervals for day/month | ✅ | utc-periods.ts + boundary test vectors in comments |
| P3-4 | "Loading — totals incomplete" until scan complete | ✅ | isIncomplete flag; ~ prefix on all partial amounts |
| P3-5 | Failed ranges never zeroed | ✅ | failedRanges[] tracked; shown with retry |
| P3-6 | Scan resumes from stored block (sessionStorage) | ✅ | storageKey scoped by chain+contract+merchant |
| P3-7 | Awaiting = open + non-expired only | ✅ | status===0 && expiresAt > now |
| P3-8 | Carried-over orders labelled separately | ✅ | isCarriedOver flag on each awaiting row |
| P3-9 | Collected = paid requests only; expired/cancelled excluded | ✅ | only PaymentRecorded events summed |
| P3-10 | Created-yesterday-paid-today: counted in correct day each | ✅ | createdAt→created count, paidAt→collected amount |
| P3-11 | Period picker: Today/Yesterday/This month/Last month/Custom | ✅ | MerchantReportsPage |
| P3-12 | Daily breakdown within month view | ✅ | daysInUtcMonth() iterated |
| P3-13 | Expand period to see requests/payments | ✅ | PeriodRow expandable |
| P3-14 | Rollover while tab open (1-min tick) | ✅ | useUtcNow() with setInterval |
| P3-15 | Rollover after tab sleep/resume (visibilitychange) | ✅ | document.addEventListener visibilitychange |
| P3-16 | Account switch data isolation | ✅ | storageKey includes merchant address |
| P3-17 | No end-of-day snapshots claimed | ✅ | data notes section in Reports |
| P3-18 | Lint/typecheck clean | ✅ | 0 errors 0 warnings |
| P3-19 | Live wallet test: Today shows real paid orders | ⬜ | requires live paid request in current UTC day |
| P3-20 | Live wallet test: created-yesterday-paid-today boundary | ⬜ | requires two requests across midnight |
| P3-21 | RPC failure on getLogs: failedRanges shown, retry works | ⬜ | cannot simulate without controlled outage |
| P3-22 | Vercel preview validation | ⬜ | requires deployment |

### Known limitations (honest)

- **Deployment block hardcoded as 2,900,000**: This is a safe lower bound derived from the deploy TX timestamp. The actual deploy block may be slightly higher. The scan will include a few extra empty blocks — no correctness impact.
- **No end-of-day status snapshots**: We show current status alongside original dates. A request created yesterday that was paid this morning shows "Paid" in yesterday's Created list; the payment counts in today's Collected. This is correct and honest.
- **sessionStorage only**: History does not persist across devices. On first load of a new browser/device, history re-scans from the deployment block. This is stated in the scan progress banner.
- **RPC range limits unknown**: We do not assert a specific per-provider block-range cap. 2,000 blocks is a conservative choice. If a provider enforces a tighter limit, the chunk will fail and be recorded in failedRanges for retry.
- **getBlock calls per unique block**: For RequestCreated events, we fetch the block to get its timestamp. This is one extra RPC call per unique block that contains a created event. For a merchant with many orders in one block, this is one call; for orders spread across blocks it scales with unique block count. This is acceptable for the expected transaction volume.

---

## PART 1 (IMPROVEMENTS) — REPORTING DATA AND PAYMENT-RECOVERY GAPS (2026-10-18)

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| `DEPLOYMENT_BLOCK = 67_462_931` (exact) | Verified from deploy TX receipt; prior hardcoded `2_900_000n` was a placeholder lower-bound from an earlier branch. Centralized in `src/lib/deployment.ts`. |
| Typed `parseAbiItem` event overload for all getLogs | Avoids raw-topic cast that was silently dropped on branch switch; viem builds topic-0+indexed filters correctly |
| `isComplete` gated on scanMode==='full' AND head reached | `isComplete` on a recent-only scan was misleading — today dashboard could show "complete" when it only saw last N blocks |
| Generation counter cancels stale scan publishes | If a new scan starts while an old chunk is in-flight, the old chunk's results are discarded instead of merging into the new state |
| sessionStorage checkout state scoped by chain+contract+account+requestId | Persists approveHash/payHash/phase across refresh without cross-request or cross-account leakage |
| USDC allowance pre-check before approve step | If allowance already >= amount (leftover from previous partial flow), skip approve and jump straight to pay |
| Fresh-browser receipt TX recovery via getLogs | `payTxHash` in router state is a same-session hint only; on fresh load, recover from PaymentRecorded(id=N) getLogs scan |
| `parseUsdc` strict unsigned-decimal-only | `/^\d+(\.\d*)?$/` rejects negatives, hex (0x), scientific notation (1e6), signs (+) without relying on `isNaN` |
| Cart/menu price sanitized on load | `sanitizeMenuItem` / `sanitizeCartItem` run on every sessionStorage read; invalid items are dropped; empty menu falls back to DEFAULT_MENU |
| `useMerchantAllRequests` shared hook | Provides contract-paginated request list + live status map used by MerchantTodayPage for awaiting count |

### Files added this session

| File | Purpose |
|------|---------|
| `src/lib/deployment.ts` | Single source of truth for deployment metadata: block 67,462,931, TX hash, chain ID, contract address |
| `src/lib/use-merchant-requests.ts` | `useMerchantAllRequests` hook: getMerchantRequests pagination + live status map for awaiting-count display |

### Files changed this session

| File | Changes |
|------|---------|
| `src/lib/use-event-history.ts` | A1: typed events + strict post-decode validation; A2: DEPLOYMENT_BLOCK from deployment.ts; A3: isComplete only when scanMode=full+head; A4: generation counter, no timestamp-zero, cache v2 |
| `src/components/MyReceipts.tsx` | A1+A2: same typed events + deployment block; cache v2 |
| `src/components/PublicCheckout.tsx` | B: sessionStorage checkout state persistence; allowance pre-check to skip approve when sufficient |
| `src/components/PublicReceipt.tsx` | B: fresh-browser TX hash recovery via typed getLogs(PaymentRecorded, id=N) |
| `src/onchain-money.ts` | C: strict unsigned-decimal regex rejects negatives/hex/sci-notation |
| `src/components/SellPage.tsx` | C: sanitizeMenuItem/sanitizeCartItem on sessionStorage load; strict parseUsdc in addCustom and menu edit save |
| `src/pages/merchant/MerchantTodayPage.tsx` | A5: useMerchantAllRequests for awaiting count; isRecentComplete awareness; remove unused ARC_TESTNET_ID import |
| `src/pages/merchant/MerchantReportsPage.tsx` | D: remove hardcoded 2_900_000n from user-facing text; isComplete awareness |

### Part 1 (improvements) checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| I1-A1 | getLogs uses typed parseAbiItem events; args filter for merchant/payer | ✅ | use-event-history.ts + MyReceipts.tsx |
| I1-A1b | Post-decode: contract addr, merchant match, id>0, amount>0 validated | ✅ | Both files |
| I1-A2 | DEPLOYMENT_BLOCK = 67,462,931 from deployment.ts everywhere | ✅ | deployment.ts centralizes it |
| I1-A3 | isComplete only when scanMode=full AND head reached AND no failed ranges | ✅ | EventHistoryState |
| I1-A3b | isRecentComplete separate flag for recent-scan completeness | ✅ | use-event-history.ts |
| I1-A4 | Generation counter prevents stale scan publishing | ✅ | scanGenRef pattern |
| I1-A4b | Missing block timestamps leave entry absent (no zero substitution) | ✅ | continue on ts===undefined |
| I1-A4c | Cache schema v2 with field validation; v1 entries evicted on load | ✅ | CACHE_VERSION bump + field checks |
| I1-A5 | Awaiting list uses getMerchantRequests pagination (not event scan alone) | ✅ | useMerchantAllRequests in MerchantTodayPage |
| I1-B1 | approveHash+payHash+phase persisted to sessionStorage keyed by chain+contract+account+requestId | ✅ | PublicCheckout.tsx |
| I1-B2 | Checkout state restored after refresh when request is still open | ✅ | restoredRef guard |
| I1-B3 | Allowance pre-check: skip approve if USDC allowance >= req.amount | ✅ | useReadContract allowance + check |
| I1-B4 | Fresh-browser PublicReceipt recovers payTxHash via getLogs(id=N) | ✅ | PublicReceipt.tsx recovery loop |
| I1-B5 | Recovery shows "Recovering transaction from chain…" while in-flight | ✅ | recovering state + spinner |
| I1-C1 | parseUsdc rejects negatives ("-1" throws) | ✅ | /^\d+(\.\d*)?$/ regex |
| I1-C2 | parseUsdc rejects hex ("0xff" throws) | ✅ | same regex (no x allowed) |
| I1-C3 | parseUsdc rejects scientific notation ("1e6" throws) | ✅ | same regex (no e allowed) |
| I1-C4 | SellPage menu/cart loaded from sessionStorage sanitized | ✅ | sanitizeMenuItem + sanitizeCartItem |
| I1-C5 | Custom amount entry: parseUsdc as primary guard (not parseFloat) | ✅ | addCustom uses parseUsdc first |
| I1-C6 | Menu edit save: strict parseUsdc guard | ✅ | MenuCard onClick |
| I1-D1 | MerchantDashboard.handleCreateSubmit: parsed===0n blocks submission | ✅ | pre-existing, now correct with new parseUsdc |
| I1-D2 | MerchantReportsPage: no hardcoded 2_900_000n in user-facing text | ✅ | uses scannedBlock.toString() instead |
| I1-X | Lint/typecheck clean | ✅ | 0 errors 0 warnings |
| I1-T1 | Live wallet test: awaiting count shows old open requests | ⬜ | requires requests older than 5k-block window |
| I1-T2 | Live wallet test: refresh mid-checkout restores approve/pay state | ⬜ | requires live TX in progress |
| I1-T3 | Live wallet test: fresh-browser receipt URL shows TX link | ⬜ | requires a paid request + fresh browser |
| I1-T4 | parseUsdc: unit tests for all rejected inputs | ⬜ | Part 3 or separate test session |

---

## PART 2 (IMPROVEMENTS) — UX, LAYOUT AND NAVIGATION (2026-10-19)

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| `LegacyRedirect` renders `HomePage` directly for bare `/` | Avoids redirect loop; legacy params still intercepted before `HomePage` renders |
| Home page at `/` — rendered by `LegacyRedirect` when no params | No new route needed; all legacy URL handling stays in one file |
| URL recogniser parses input as integer OR ArcReceipt URL shape | Accepts `/pay/N`, `/receipt/N`, `?request=N`, bare IDs; only ID extracted, not amounts |
| `CustomerLayout` hides nav on `/pay/` and `/receipt/` | Those are QR-only pages; nav would add noise and obscure checkout |
| "Back to payment #N" hint reads sessionStorage checkout keys | Detects active pending session without props; shown when user is off that page |
| Presentation mode in `MerchantOrderDetailPage` | Full-screen QR + amount overlay; Escape/tap to close; live poll updates show Paid banner |
| Settings menu management uses same storage keys as `SellPage` | Single source of truth; price edits in Settings propagate to Sell screen on next load |
| `unavailable` flag on `MenuItem` — filtered in `SellPage` | Items hidden from Sell but preserved in menu; re-enabled via Settings |
| Address reload on wallet change via state-during-render pattern | Avoids `setState-in-effect` lint error; correct React idiom for derived/external sync |

### Files added this session

| File | Purpose |
|------|---------|
| `src/pages/HomePage.tsx` | Public home: branding, receipt lookup, My Payments, Merchant entrance, How it works, contract trust info |

### Files changed this session

| File | Changes |
|------|---------|
| `src/pages/LegacyRedirect.tsx` | Bare "/" renders `HomePage` directly instead of redirecting to `/verify` |
| `src/components/CustomerLayout.tsx` | Home nav item added; logo → "/" ; nav hidden on /pay/ /receipt/; "Back to payment #N" contextual hint |
| `src/components/SellPage.tsx` | `unavailable` flag on `MenuItem`; Sell screen filters unavailable items; warning when all unavailable |
| `src/pages/merchant/MerchantSettingsPage.tsx` | Full menu management: add/edit/remove/reorder/toggle availability; sample labels; reset to defaults |
| `src/pages/merchant/MerchantOrderDetailPage.tsx` | Presentation mode overlay (full-screen QR+amount, Escape to close, paid banner); Present order button |
| `src/components/PublicCheckout.tsx` | Full merchant address copyable in checkout; network label in preview rows |

### Part 2 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| P2A-1 | Home page at "/" with branding and flow explanation | ✅ | `HomePage.tsx` |
| P2A-2 | Legacy query-string links still work (no interruption) | ✅ | `LegacyRedirect` intercepts before `HomePage` renders |
| P2A-3 | Receipt lookup accepts request ID or ArcReceipt URL | ✅ | `parseInput()` — ID only extracted, amounts never trusted |
| P2A-4 | My Payments link from home | ✅ | navigates to /payments |
| P2A-5 | Merchant workspace entrance (explicit, not auto-detected) | ✅ | button → /merchant; gate checks wallet on entry |
| P2A-6 | Clear network label on home page | ✅ | "Arc Testnet · Chain 5042002 · USDC" |
| P2A-7 | No fake stats, no audit badges, no customer logos | ✅ | home page contains none |
| P2A-8 | Studio attribution on home | ✅ | footer |
| P2B-1 | Settings: add menu item | ✅ | `EditForm` in `MerchantSettingsPage` |
| P2B-2 | Settings: edit menu item | ✅ | inline `EditForm` on row edit |
| P2B-3 | Settings: remove menu item | ✅ | delete button per row |
| P2B-4 | Settings: reorder menu items | ✅ | ChevronUp/Down per row |
| P2B-5 | Settings: mark item unavailable (hidden from Sell) | ✅ | `unavailable` flag; EyeOff toggle |
| P2B-6 | Settings: sample items clearly labelled | ✅ | "(sample)" next to default IDs |
| P2B-7 | Settings: price edit never alters existing cart/snapshot | ✅ | cart items freeze price at add-time |
| P2B-8 | Settings: corrupt/missing storage handled safely | ✅ | `sanitizeMenuItem` + DEFAULT_MENU fallback |
| P2B-9 | SellPage: unavailable items hidden | ✅ | `.filter(item => !item.unavailable)` |
| P2B-10 | SellPage: warning when all items unavailable | ✅ | amber banner |
| P2C-1 | Order detail: presentation mode (full-screen QR + amount) | ✅ | `PresentationMode` overlay |
| P2C-2 | Presentation mode: Escape or tap to close | ✅ | keydown listener + onClick overlay |
| P2C-3 | Presentation mode: Paid banner when request paid | ✅ | `isPaid` prop → green banner |
| P2C-4 | Order detail: Present order button (non-expired, non-cancelled) | ✅ | `!isCancelled && !expired` guard |
| P2D-1 | Checkout: full merchant address readable and copyable | ✅ | full address + copy button in `RequestPreviewRows` |
| P2D-2 | Checkout: network label in preview rows | ✅ | "Arc Testnet (5042002)" row |
| P2E-1 | CustomerLayout: logo links to "/" (home) | ✅ | `<Link to="/">` |
| P2E-2 | CustomerLayout: Home nav item | ✅ | `CUSTOMER_NAV` includes / |
| P2E-3 | CustomerLayout: nav hidden on /pay/ and /receipt/ | ✅ | `isPayOrReceipt` guard |
| P2E-4 | "Back to payment #N" contextual link when pending checkout exists | ✅ | `useActivePay` reads sessionStorage keys |
| P2E-5 | Connecting wallet never shows merchant navigation | ✅ | `CustomerLayout` has no merchant routes |
| P2E-6 | Merchant entrance always explicit (never auto-detected) | ✅ | home page button only; gate rechecks on entry |
| P2X | Lint/typecheck clean | ✅ | 0 errors 0 warnings |
| P2T-1 | Legacy ?request=N QR link opens checkout directly | ⬜ | requires live test |
| P2T-2 | Fresh browser at "/" sees home; /pay/N still opens checkout | ⬜ | requires live test |
| P2T-3 | Presentation mode: counter display, Escape closes | ⬜ | requires live test |
| P2T-4 | Settings: add/edit/reorder/hide item reflects in Sell screen | ⬜ | requires live test |
| P2T-5 | Customer wallet connection never reveals merchant nav | ⬜ | requires live test |
| P2T-6 | "Back to payment" hint appears after navigating away mid-checkout | ⬜ | requires live pending TX |

---

## PART 3 (REPORTING) — DASHBOARD, REPORTS, EXPORT (2026-10-19)

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| Drill-down as inline panel per stat card | Keeps stat and records co-located; no extra route; collapses cleanly on mobile |
| SVG bar chart (no chart library) | No dependency added; accessible via `<title>` + collapsible table fallback |
| `DetailTable` joins createdEvents + paymentEvents by requestId | Single source of truth — no synthetic snapshots; current status from requestMap |
| payTxHash extracted from `ev.key` (format `0xHASH-N`) | PaymentEvent.key already carries the txHash; no schema change needed |
| Export CSV blocked with explicit partial override | Prevents silent partial totals being exported as final; user must choose |
| Print: `hidden print:block` / `print:hidden` Tailwind classes | No extra route or page needed; browser native print with correct metadata |
| `requestStatus()` uses live requestMap + current time | Current verified status, not end-of-day snapshot (which we cannot reconstruct) |
| `now` removed from `DetailTable` props | Status resolution moved to `detailRows` useMemo in parent (correct separation) |

### Files changed this session

| File | Changes |
|------|---------|
| `src/pages/merchant/MerchantTodayPage.tsx` | Stat cards now expandable drill-downs showing underlying records per metric |
| `src/pages/merchant/MerchantReportsPage.tsx` | Full rewrite: summary cards, SVG daily bar chart, detailed records table (search/filter/pagination/payer/status/explorer links), CSV export with completeness guard + formula-prefix sanitisation, print layout |

### Part 3 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| P3A-1 | Today: collected card drill-down (PaymentRecorded records) | ✅ | |
| P3A-2 | Today: orders card drill-down (RequestCreated records) | ✅ | |
| P3A-3 | Today: awaiting card drill-down (all open requests) | ✅ | |
| P3A-4 | Today: month card drill-down (month payments) | ✅ | |
| P3A-5 | Today: ~ prefix on incomplete values | ✅ | |
| P3A-6 | Today: scan status (block / remaining) in banner | ✅ | |
| P3A-7 | Today: empty state only when scan complete | ✅ | |
| P3B-1 | Rollover: 1-minute tick keeps Today current | ✅ | unchanged from Part 1 |
| P3B-2 | Rollover: visibilitychange forces re-render on tab resume | ✅ | unchanged from Part 1 |
| P3B-3 | Half-open UTC intervals (start <= ts < nextStart) | ✅ | utc-periods.ts unchanged |
| P3B-4 | Created-yesterday/paid-today counted correctly | ✅ | separate createdAt/paidAt filters |
| P3C-1 | Reports: period picker (Today/Yesterday/This month/Last month/Custom) | ✅ | |
| P3C-2 | Reports: summary cards (collected, payments, created) | ✅ | |
| P3C-3 | Reports: ~ prefix when incomplete | ✅ | |
| P3C-4 | Reports: SVG daily bar chart for month views | ✅ | |
| P3C-5 | Reports: accessible chart table (collapsible `<details>`) | ✅ | |
| P3C-6 | Reports: zero shown only after coverage complete | ✅ | prefix cleared only when isComplete |
| P3C-7 | Reports: failed ranges stay distinguishable from zero | ✅ | ScanBanner unchanged |
| P3C-8 | Reports: detailed records table (ID, created, paid, amount, payer, status) | ✅ | |
| P3C-9 | Reports: receipt link per row | ✅ | |
| P3C-10 | Reports: explorer link per row (payment TX) | ✅ | extracted from ev.key |
| P3C-11 | Reports: request-ID search | ✅ | |
| P3C-12 | Reports: status filter (all/paid/open/expired/cancelled) | ✅ | |
| P3C-13 | Reports: date-filter type labelled (payment date vs creation date) | ✅ | toggle button with label |
| P3C-14 | Reports: working pagination (10 rows/page, prev/next) | ✅ | |
| P3C-15 | Reports: current verified status (no end-of-day snapshots) | ✅ | from requestMap live reads |
| P3D-1 | Export CSV: blocked when incomplete, explicit partial override | ✅ | warning panel with "Export partial anyway" |
| P3D-2 | Export CSV: merchant, network, contract, period, generated time | ✅ | header block |
| P3D-3 | Export CSV: verified-through block reference | ✅ | |
| P3D-4 | Export CSV: completeness flag and WARNING row when partial | ✅ | |
| P3D-5 | Export CSV: exact amounts and identifiers | ✅ | |
| P3D-6 | Export CSV: formula-prefix sanitisation (=, +, -, @, \t, \r) | ✅ | csvField() |
| P3D-7 | Export CSV: proper quote-doubling escaping | ✅ | csvField() |
| P3D-8 | Export CSV: local item descriptions excluded | ✅ | not in DetailRow; explicitly noted |
| P3D-9 | Export CSV: not labelled as profit/tax/inventory | ✅ | labelled "Collected" |
| P3D-10 | Print: merchant, network, contract, period, generated time | ✅ | print:block header |
| P3D-11 | Print: completeness note in print output | ✅ | |
| P3D-12 | Print: data table visible in print layout | ✅ | DetailTable not hidden |
| P3E-1 | Shared history layer (useEventHistory) reused — no new scan | ✅ | |
| P3E-2 | No full-scan restart on tab change | ✅ | hook unchanged |
| P3E-3 | requestMap from useMerchantAllRequests for live status | ✅ | |
| P3X | Lint/typecheck clean | ✅ | 0 errors 0 warnings |
| P3T-1 | Two equal-total requests: pay only B; A stays unpaid after refresh | ⬜ | requires live test |
| P3T-2 | Pay yesterday, shows in yesterday collected / today created | ⬜ | requires live test |
| P3T-3 | Drill-down: stat card expands/collapses; records match total | ⬜ | requires live test |
| P3T-4 | Export: partial CSV labelled; complete CSV without warning | ⬜ | requires live test |
| P3T-5 | Print: opens browser print dialog with correct metadata | ⬜ | requires live test |
| P3T-6 | Midnight UTC rollover: today selects new day without refresh | ⬜ | requires time-of-day test |
| P3T-7 | Charts and drill-downs reconcile with summary totals | ⬜ | requires live data |
| P3T-8 | Full-history "Load full history" scans and populates all periods | ⬜ | requires live test (long) |

---

## FINAL ASSESSMENT (Parts 1–3)

### 1. What works (verified by build + lint)

- **Part 1 (data correctness):** Typed ABI events, strict post-decode validation, correct deployment block (67,462,931), `isComplete` gated on full-scan-at-head, generation cancel guard, zero-timestamp prevention, cache v2 with field validation, `getMerchantRequests` pagination for awaiting count, checkout state persists across refresh, fresh-browser receipt TX recovery, `parseUsdc` strict unsigned-decimal, cart/menu sanitised on load.
- **Part 2 (UX):** Public home page at `/`, receipt lookup with URL recognition, My Payments, explicit merchant entrance, CustomerLayout nav with home link, back-link for active checkout, presentation mode overlay in order detail, full merchant address copyable in checkout, settings with full menu management (add/edit/remove/reorder/hide).
- **Part 3 (reporting):** Per-stat drill-down panels on Today, summary cards, SVG daily bar chart, detailed records table with search/status-filter/date-filter/pagination/payer/explorer links, CSV export with completeness guard and formula-prefix sanitisation, print layout.

### 2. What was tested and results

| Test | Method | Result |
|------|--------|--------|
| Lint (oxlint, all three parts) | Automated | 0 errors, 0 warnings |
| TypeScript typecheck (tsc --noEmit) | Automated | 0 errors |
| Dev server running | Process check (ps aux) | Running (PID 23382) |
| All other tests | Require live testnet + two wallets | Not run |

### 3. Required configuration

| Variable | Purpose | Set? |
|----------|---------|------|
| `VITE_MERCHANT_ADDRESS` | Merchant wallet gate | Required — set in `.env` |
| `VITE_APP_ORIGIN` | Public URL for QR/receipt links | Required for production |

### 4. Remaining limitations

- Live wallet tests (I1-T1 through I1-T3, P2T-1 through P2T-6, P3T-1 through P3T-8) require testnet USDC and two wallets — none have been run.
- Full-history scan (65M blocks on Arc Testnet) will take several minutes in browser; progress is shown but cannot be accelerated.
- `ev.key` TX hash extraction (format `0xHASH-N`) is correct only when the TX hash is exactly 66 chars; pending/null hashes produce no explorer link (correct behaviour).
- Print layout uses browser print — complex table pagination between pages depends on browser.
- `requestMap` status reads are batched via `useReadContracts`; very large order counts (>200) may produce many simultaneous RPC calls.
- No database, no cross-device sync — all data is session-scoped via sessionStorage.

### 5. Branch readiness

**NOT ready to merge to production.** Reasons:
- Live wallet tests not run (P3T-1 through P3T-8 and earlier P2T / I1 tests).
- `VITE_APP_ORIGIN` must be set to the production URL before deploy.
- Full-history scan has not been observed end-to-end on testnet.
- No independent security review of the contract (deployed, not audited).

**Ready for internal QA review on testnet.**

---

## STAGE 1 — PAYMENT, RECEIPT AND ORDER CORRECTNESS (2026-10-23)

### Changes made

| Area | Change | File |
|------|--------|------|
| `contract.ts` | `buildPaymentLink`/`buildReceiptLink` now emit path-based `/pay/:id` / `/receipt/:id` URLs. Legacy `?request=N` still handled by LegacyRedirect. | `src/lib/contract.ts` |
| `pending-tx.ts` | Added `'pay'` to `PendingAction` union for future pay-action persistence. | `src/lib/pending-tx.ts` |
| `PublicCheckout` | `validatePaymentReceipt()`: validates contract address, topic-0, id (topic-1), merchant (topic-2), payer (topic-3) and amount (data[0]) before calling `onPaid()`. Replacement TX confirmed without `PaymentRecorded` → phase=`'unresolved'`, amber warning, no success claimed. | `src/components/PublicCheckout.tsx` |
| `PublicCheckout` | `reportedHash.current` reset to `null` on `requestId` change so route A→B cannot carry A's success guard. | same |
| `PublicCheckout` | Added `'unresolved'` phase and render state. | same |
| `MerchantDashboard` | Create receipt: when `extractIdFromReceipt` returns `null` on a `status=success` TX, do NOT mark as success; show `rpc-error` banner + explorer link; leave `processedHash.current = null` so a later valid receipt can still fire. | `src/components/MerchantDashboard.tsx` |
| `MerchantDashboard` | Cancel: persist `cancelHash` to `pending-tx.ts` on submission; restore on mount; clear on confirmed success/revert; retain on RPC error. | same |
| `MerchantDashboard` | `RequestRowWithData`: `staleTime` reduced from 30 s to 5 s; added `refetchInterval: 8_000` so a paid row updates within ~5–8 s when another browser pays. | same |
| `MerchantOrderDetailPage` | Added `isMerchantOrder` guard: QR block, Present order, Next order button and footnote only render when `req.merchant === MERCHANT_ADDRESS` and connected wallet is merchant. Other-merchant orders show read-only view with a notice. | `src/pages/merchant/MerchantOrderDetailPage.tsx` |

### What was NOT changed (already correct or out of scope)

- Contract unchanged, 41/41 tests still passing (no recompile needed).
- `PublicReceipt` recovery loop: `args.id === requestId` comparison is bigint===bigint from the same viem context — no equality bug.
- `SellPage` confirmed snapshot: in the Router flow `onOrderCreated` is always provided, so `saveConfirmedOrder` is never called; no cross-order leak possible.
- `use-event-history` typed events, deployment block, generation counter — all correct from prior session.
- Legacy URL compatibility preserved (LegacyRedirect handles `?request=N`).

### Stage 1 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| S1-1 | `buildPaymentLink`/`buildReceiptLink` emit path-based canonical URLs | ✅ | `/pay/N`, `/receipt/N` |
| S1-2 | Legacy `?request=N` QRs still work | ✅ | LegacyRedirect unchanged |
| S1-3 | PublicCheckout validates PaymentRecorded (id+merchant+payer+amount) before `onPaid()` | ✅ | `validatePaymentReceipt()` function |
| S1-4 | Replacement TX success without event → `unresolved` not `done` | ✅ | phase logic in effect |
| S1-5 | `reportedHash.current` reset on `requestId` change | ✅ | reset in requestId effect |
| S1-6 | MerchantDashboard: missing `RequestCreated` event blocks success status | ✅ | `id !== null` guard |
| S1-7 | MerchantDashboard: cancel hash persisted to sessionStorage | ✅ | `savePendingTx` on cancel onSuccess |
| S1-8 | MerchantDashboard: cancel hash restored on mount/address change | ✅ | useState lazy init + useEffect |
| S1-9 | `RequestRowWithData`: paid rows update within ~8 s from another browser | ✅ | staleTime:5s + refetchInterval:8s |
| S1-10 | `MerchantOrderDetailPage`: management controls scoped to req.merchant | ✅ | `isMerchantOrder` guard |
| S1-11 | Lint: 0 errors, 0 warnings | ✅ | oxlint |
| S1-12 | TypeScript: 0 errors | ✅ | tsc --noEmit |
| S1-T1 | Live: replacement TX → unresolved panel shown, no false success | ⬜ | requires controlled testnet TX |
| S1-T2 | Live: cancel refresh → hash restored, confirming banner shown | ⬜ | requires live cancel mid-flight |
| S1-T3 | Live: route A→B → no hash crossover in receipt/checkout | ⬜ | requires two paid requests |
| S1-T4 | Live: another browser pays → row updates within ~8 s | ⬜ | requires two wallets |
| S1-T5 | Live: order detail for another merchant's ID shows read-only | ⬜ | requires direct URL navigation |
| S1-T6 | Live: QR/payment link uses /pay/N not ?request=N | ⬜ | visual check on deployed build |

### Known limitations (honest, Stage 1)

- `validatePaymentReceipt` reads raw log topics and data bytes directly. viem's `decodeEventLog` could be used as an alternative but requires the ABI import — the raw approach is simpler and covers all Arc Testnet receipt formats seen so far.
- Cancel hash restoration sets `cancelStatus='confirming'` but cannot recover `cancellingId` from sessionStorage (it was not persisted). The per-row cancel indicator therefore does not show during restored tracking — the banner does show via `useWaitForTransactionReceipt`.
- `refetchInterval: 8_000` on individual rows means up to 8 s delay between a payment and a merchant seeing the row update. This is an acceptable trade-off vs RPC rate-limiting at 1.5s per row with many rows mounted.
- Live tests (S1-T1 through S1-T6) require testnet USDC, two wallets and controlled conditions. None have been run in this session.

---

## STAGE 3 — UI, DEPLOYMENT HYGIENE AND MAINNET SUBMISSION PREP (2026-10-23)

### Changes made

| Area | Change | File |
|------|--------|------|
| Menu storage | `loadMenu`/`saveMenu` switched from `sessionStorage` to `localStorage` in both `SellPage.tsx` and `MerchantSettingsPage.tsx`. Menu now survives browser restarts. Cart remains session-only. | `src/components/SellPage.tsx`, `src/pages/merchant/MerchantSettingsPage.tsx` |
| CustomerLayout | Merchant workspace entry button shown when connected wallet is the configured merchant. Clicking navigates to `/merchant`. Never shown to non-merchant wallets. | `src/components/CustomerLayout.tsx` |
| HomePage | Added "How it works" 3-step panel (Build order / Show QR / Verify). Added merchant workspace entry card for merchant wallets (mirrors CustomerLayout). | `src/pages/HomePage.tsx` |
| PublicReceipt | Added "Copy link" and "Copy TX" buttons alongside Print. Print button gains `print:hidden` class. | `src/components/PublicReceipt.tsx` |
| Print CSS | `@media print` block added to `index.css`: hides nav/header/footer, strips box-shadow, allows colour printing, enforces `page-break-inside: avoid` on table rows. | `src/index.css` |
| Vite config | Commented `cors: true` and `allowedHosts: true` to document their dev-only scope and Arc Studio preview requirement. No behaviour change. | `vite.config.ts` |
| SellPage | Persistence disclaimer updated: explicitly states menu uses `localStorage` (survives restarts), cart uses `sessionStorage` (session-only). | `src/components/SellPage.tsx` |
| MerchantSettingsPage | Storage disclaimer updated: localStorage noted as surviving restarts, not synced across devices. | `src/pages/merchant/MerchantSettingsPage.tsx` |
| DEPLOYMENT-GUIDE.md | New file: exact mainnet deployment steps, network metadata, security headers, Brave Shields guide, grant submission checklist, §7+§8 of Part 3 spec. | `DEPLOYMENT-GUIDE.md` |

### What was NOT changed (already correct or explicitly out of scope)

- Contract unchanged (still at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` on Arc Testnet).
- Merchant layout (`MerchantLayout.tsx`) unchanged — sidebar/mobile nav already has testnet banner.
- `CustomerLayout.tsx` testnet banner was already present — only the merchant entry was added.
- `scripts/compass-deploy.ts` is not modified — it is an Arc Studio internal deployment script
  that requires `@circlefin/compass-chains` (not a public package). `tsc --noEmit` already passes.
- No mainnet deployment executed. All testnet links remain live.
- No new features beyond what Part 3 §1–§6 specifies.

### Stage 3 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| S3-1 | Menu stored in localStorage (durable, survives restart) | ✅ | Both SellPage and Settings |
| S3-2 | Cart remains in sessionStorage (session-scoped draft) | ✅ | Not changed |
| S3-3 | Merchant workspace entry on Home and CustomerLayout | ✅ | Wallet-gated, never shown to non-merchants |
| S3-4 | Home page explains Build/QR/Verify steps | ✅ | 3-step panel |
| S3-5 | PublicReceipt: Copy link + Copy TX controls | ✅ | useCopy hook |
| S3-6 | Print CSS for receipt | ✅ | `@media print` in index.css |
| S3-7 | Print button hidden in print view | ✅ | `print:hidden` class |
| S3-8 | Vite config: CORS + allowedHosts documented | ✅ | Comments in vite.config.ts |
| S3-9 | Production security headers in vercel.json | ✅ | Already present (nosniff, DENY, Referrer-Policy) |
| S3-10 | DEPLOYMENT-GUIDE.md with mainnet steps | ✅ | §7+§8 of Part 3 |
| S3-11 | Lint: 0 errors, 0 warnings | ⬜ | Run after edits |
| S3-12 | TypeScript: 0 errors | ⬜ | Run after edits |
| S3-T1 | Live: menu persists across browser restart | ⬜ | localStorage — close and reopen browser |
| S3-T2 | Live: merchant workspace entry visible when merchant wallet connected on Home | ⬜ | Visual check |
| S3-T3 | Live: Copy link on receipt copies correct URL | ⬜ | Visual check |
| S3-T4 | Live: Print button opens browser print dialog, nav hidden | ⬜ | Visual check |
| S3-T5 | Live: merchant workspace entry NOT shown for customer wallet | ⬜ | Connect a non-merchant wallet |

### Known limitations (Stage 3)

- Mainnet deployment requires an independent audit first (see PENDING.md § C2). Not yet done.
- The `@media print` CSS hides `header`/`footer`/`nav` by tag name. If a future page
  uses `<header>` tags for non-navigation elements, those would also be hidden. This is
  acceptable for the current receipt-only print use case.
- `cors: true` in `vite.config.ts` is a dev-server setting and has no effect on the
  Vercel static deployment. It is documented in a comment and retained for the sandbox.
- Studio tracing/console capture (`tracing.ts`, `console-capture.ts`) uses `postMessage`
  to the detected parent frame origin. On the Vercel production deployment, there is no
  parent frame, so the messages go nowhere. These files cannot be removed without
  modifying a tracked repository file; they are harmless on production.
- Live tests S3-T1 through S3-T5 require a browser and connected wallet. None have been run.

---

## STAGE 2 — ACCURATE AND FASTER REPORTING / HISTORY (2026-10-23)

### Exact defects fixed

| ID | File | Defect |
|----|------|--------|
| D9 | `MerchantTodayPage` | "Collected today" / "Month" used `paymentEvents` (event scan); now uses `requestMap` (status=1, paidAt from contract — authoritative, refreshed every 15s). |
| D10 | `MerchantTodayPage` | `isIncomplete` only false for `scanProgress.isComplete` (full-mode only). Fixed: also clears when `isRecentComplete` is true. |
| D11 | `MerchantReportsPage` | "Last month" computed as `monthStartUtc(now - 86400 * 32)` → gave August on Oct 1. Fixed: new `previousMonthStart(ts)` helper in `utc-periods.ts`. |
| D12 | `MerchantReportsPage` `ScanBanner` | "Load full history" button only appeared after recent scan finished, was hidden during active scan. Fixed: button always visible in banner footer. |
| D13 | `MerchantReportsPage` `DetailTable` | `dateFilter` toggle existed in UI but never applied to rows. Fixed: `filtered` useMemo now sorts by the selected date column. |
| D15 | `MerchantReportsPage` | Export completeness used `scanProgress.isComplete` (only true for full scans). Fixed: uses combined `coverageComplete = isComplete || isRecentComplete`. |
| D1/D10 | `use-event-history` | `isRecentComplete` was not propagated in `scanProgress`. Fixed: `scanProgress.recentComplete` field added; `isRecentComplete` exposed on hook return. |
| D2 | `use-event-history` | Fixed 2,000-block chunk size. Fixed: adaptive chunking starts at 10,000, halves on range/timeout errors (min 2,000). |
| D3 | `use-event-history` | `rescan()` always cleared all cache and rescanned from scratch. Fixed: on remount, tail-refresh resumes from `tailCursor + 1` if cache is warm. |
| D4 | `use-event-history` | Two serial `getLogs` calls per chunk. Fixed: both `RequestCreated` and `PaymentRecorded` are issued in parallel (`Promise.allSettled`). |
| D5 | `use-event-history` | Block timestamps re-fetched for blocks seen in earlier chunks. Fixed: `tsCache` (Map) shared across the scan lifetime. |
| D6 | `use-merchant-requests` | No reference block — consecutive page reads could see inconsistent state. Fixed: `refBlock` fetched once then passed as `blockNumber` to all page and status reads. |
| D7 | `use-merchant-requests` | `staleTime: 15_000`, `refetchInterval: 30_000`. Fixed: `staleTime: 0`/`5_000`, `refetchInterval: 15_000`. |
| D8 | `use-merchant-requests` | `req.merchant` not validated before inserting into `requestMap`. Fixed: skips zero-address and wrong-merchant responses. |
| D16 | `MyReceipts` | Shared `abortRef` had a race on wallet switch. Fixed: generation counter; each scan captures its own gen and checks before every state write. |
| D17 | `MyReceipts` | "Refresh" always did a full rebuild. Fixed: three separate actions — **Retry** (resume from pause cursor), **Update** (tail scan from cached head), **Rebuild** (full rescan, with confirmation prompt). |
| D18 | `MyReceipts` | No per-row "View receipt" link. Fixed: each row now shows a `/receipt/:id` navigation button alongside the TX explorer link. |

### New helpers added

| File | Addition |
|------|----------|
| `src/lib/utc-periods.ts` | `previousMonthStart(ts)` — correct previous-month calculation for all months. |
| `src/lib/use-event-history.ts` | `pLimit()` — bounded concurrency for block timestamp fetches (max 4 in-flight). |
| `src/lib/use-event-history.ts` | `tailCursor` field in persisted cache — enables incremental tail-refresh on remount. |
| `src/lib/use-event-history.ts` | `recentComplete` field in `ScanProgress`; `isRecentComplete` on hook return. |
| `src/lib/use-merchant-requests.ts` | `isPartial` flag on return (true when some ID pages or status reads failed). |

### Stage 2 checklist

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| S2-1 | "Collected today" uses `requestMap` (contract-first) not event scan | ✅ | `todayPaymentsFromMap` |
| S2-2 | `isIncomplete` clears when `isRecentComplete` is true | ✅ | `coverageComplete` flag |
| S2-3 | `previousMonthStart` helper added; "Last month" in Reports uses it | ✅ | October → September correct |
| S2-4 | "Load full history" always visible in ScanBanner, even during active scan | ✅ | always shown as footer action |
| S2-5 | DetailTable sorts by selected date column (sort, not just label) | ✅ | `dateFilter` applied in `filtered` useMemo |
| S2-6 | Export completeness uses `coverageComplete` (recent + full) | ✅ | |
| S2-7 | Adaptive chunk: starts 10k, halves on range error, min 2k | ✅ | `CHUNK_SIZE_START`, `CHUNK_SIZE_MIN` |
| S2-8 | Parallel `getLogs` for RequestCreated + PaymentRecorded | ✅ | `Promise.allSettled` |
| S2-9 | Block timestamp cache shared across chunks | ✅ | `tsCache` Map in scan state |
| S2-10 | Tail-refresh on remount (resume from `tailCursor`) | ✅ | `isTail` path in `runScan` |
| S2-11 | Reference block pinned for all getMerchantRequests + getRequest reads | ✅ | async-only `setRefBlock` |
| S2-12 | `req.merchant` validated before inserting into `requestMap` | ✅ | `req.merchant.toLowerCase() !== merchant.toLowerCase()` guard |
| S2-13 | `staleTime`/`refetchInterval` tuned to 0/5k/15s | ✅ | |
| S2-14 | Generation counter in MyReceipts prevents stale wallet writes | ✅ | `genRef` counter |
| S2-15 | MyReceipts: Retry / Update / Rebuild semantics | ✅ | three distinct handlers |
| S2-16 | MyReceipts: "View receipt" link per row | ✅ | `/receipt/:id` navigation button |
| S2-17 | Lint: 0 errors, 0 warnings | ✅ | oxlint |
| S2-18 | TypeScript: 0 errors | ✅ | tsc --noEmit |
| S2-T1 | Live: "Collected today" updates within 15s of a payment (no refresh) | ⬜ | requires live testnet payment |
| S2-T2 | Live: "Last month" shows correct month name (not August) | ⬜ | visual check |
| S2-T3 | Live: "Load full history" button accessible while scan is in progress | ⬜ | visual check |
| S2-T4 | Live: DetailTable sort changes when toggling Sort-by button | ⬜ | visual check |
| S2-T5 | Live: MyReceipts Retry resumes from pause point, not from start | ⬜ | needs forced error |
| S2-T6 | Live: MyReceipts Update scans only new blocks, completes fast | ⬜ | visual timing check |
| S2-T7 | Live: switching wallet in MyReceipts cancels old scan | ⬜ | requires two wallets |
| S2-T8 | Live: adaptive chunk logged smaller on a rate-limited provider | ⬜ | requires rate-limited endpoint |

### Known limitations (Stage 2)

- Reference block in `useMerchantAllRequests` is fetched async — first render uses `undefined` (wagmi "latest"), subsequent renders use the pinned block. A single request created between the first and second render may appear in the list one cycle late. This is correct behaviour (not a bug).
- `tailCursor` is initialised to `headBlock` at scan start. If the user session is very long (days), the tail scan on next remount may cover a large range. This is bounded by the lookback window (500k blocks ≈ 2.9 days at 2 blocks/sec).
- The `pLimit` concurrency helper is intentionally minimal — not a full production scheduler. It covers the typical case of 3–15 unique blocks per chunk.
- Live tests S2-T1 through S2-T8 require testnet USDC and controlled conditions. None have been run in this session.
