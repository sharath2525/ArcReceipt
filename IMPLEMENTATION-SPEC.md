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
