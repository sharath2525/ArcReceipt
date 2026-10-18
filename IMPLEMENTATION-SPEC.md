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
