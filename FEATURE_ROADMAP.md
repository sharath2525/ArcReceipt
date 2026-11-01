# ArcReceipt — Feature Roadmap

This document lists all planned improvements, organised by phase.
Items marked **[CONTRACT UPGRADE NEEDED]** require deploying a new contract and updating `VITE_CONTRACT_ADDRESS`.
All other items are frontend-only changes against the current deployed contract.

---

## Phase 1 — Polish (frontend only, no contract change)

These can be shipped any time with a code change + push to GitHub.

### UI / UX

- [ ] **Dark mode** — toggle in settings, persisted to localStorage
- [ ] **Better mobile layout on Sell screen** — larger tap targets for item cards, sticky total bar at bottom
- [ ] **Menu item images** — upload a photo per item in Settings, stored in localStorage (no server needed)
- [ ] **Custom colour / brand theme** — merchant can pick an accent colour in Settings
- [ ] **Animated QR reveal** — smooth transition from "creating order" to QR card
- [ ] **Sound on payment confirmed** — optional audio feedback when a payment lands
- [ ] **Share button on receipt** — one-tap share to copy link or share via native OS share sheet
- [ ] **Print receipt** — `window.print()` styled receipt page for physical paper copy
- [ ] **Better empty states** — illustrated empty states on Orders, Today, Reports pages

### Merchant dashboard

- [ ] **Today page live auto-refresh** — poll for new payments every 30 seconds without manual refresh
- [ ] **Order search and filter** — filter by status (Open / Paid / Cancelled / Expired), amount range, date
- [ ] **Bulk cancel** — select multiple open orders and cancel them in one go
- [ ] **Quick-reorder** — repeat a previous order with one tap from the Orders list
- [ ] **Weekly and monthly summary cards** on Reports page (total revenue, number of orders, average order size)
- [ ] **Revenue chart** — bar chart of daily revenue over the last 30 days on Reports page
- [ ] **Multi-currency display** — show USDC amounts with an approximate fiat equivalent (using a public price feed, display-only)

### Customer experience

- [ ] **Payment link preview** — when sharing a link, show a rich preview (amount, merchant name, expiry countdown)
- [ ] **Expiry countdown on checkout** — live timer showing how long the customer has left to pay
- [ ] **My Payments improvements** — group by merchant, search by amount or date, export CSV
- [ ] **Verify page improvements** — show full transaction details including block number and timestamp

---

## Phase 2 — New features (frontend only, no contract change)

These are larger features that still work with the current contract.

### Multi-merchant support

- [ ] **Public merchant profile page** at `/merchant/:address` — shows business name, logo, and recent open requests. Any wallet can be a merchant; the profile is assembled from onchain events.
- [ ] **Merchant directory** — a simple index page listing merchants who have opted in (stored onchain via an event).

### Notifications

- [ ] **Browser push notifications** — when a customer pays, notify the merchant via the Web Push API (requires a small notification relay server).
- [ ] **In-app notification badge** — show a badge on the Orders tab when a new payment arrives.

### Onboarding

- [ ] **Guided setup wizard** — first-time merchant setup: set business name, add menu items, make a test payment.
- [ ] **Demo mode improvements** — fully offline simulation of the complete merchant + customer flow, useful for presentations.
- [ ] **"Get test USDC" button** — direct link to Arc Studio testnet faucet for new users.

### Analytics

- [ ] **Hourly heatmap** — which hours of the day generate the most revenue.
- [ ] **Top items report** — which menu items are ordered most often (derived from order amounts matching known prices).

---

## Phase 3 — Contract upgrade needed

These features require a new contract deployment. After deploying, update `VITE_CONTRACT_ADDRESS` in Vercel and redeploy. See `DEPLOY_NEW_CONTRACT.md` for the deployment process.

**Important:** the current contract has no upgradeability. A "new contract" means a completely new deployment at a different address. Existing payments on the old contract remain valid and readable forever — they just live at the old address.

### Planned contract features

- [ ] **Partial payments** — allow a customer to pay in multiple transactions towards a total amount.
- [ ] **Split payments** — one payment request split between multiple payers (e.g. a table splitting a bill).
- [ ] **Recurring payments** — a merchant creates a standing request that can be paid multiple times (e.g. a weekly subscription or entry fee).
- [ ] **Refund support** — merchant can initiate a USDC refund back to the payer for a specific request. Requires the contract to hold funds briefly during the refund window.
- [ ] **On-behalf creation** — a third party (e.g. a staff member) can create requests on behalf of the merchant address.
- [ ] **Multi-token support** — accept EURC or other Circle-supported stablecoins in addition to USDC.
- [ ] **Request metadata hash** — store an IPFS/CID hash onchain alongside the request so merchants can attach a full item breakdown to a receipt.
- [ ] **Longer expiry** — current max is 30 days. A new contract could allow longer windows or no expiry for standing orders.

---

## Phase 4 — Platform expansion

Longer-term directions that would turn ArcReceipt into a multi-vendor platform.

- [ ] **Mobile app (React Native or PWA)** — installable app for merchants who use a phone at a stall.
- [ ] **Merchant SDK** — a small JS package so any website can embed an ArcReceipt checkout button.
- [ ] **Gateway integration** — use Circle Gateway so merchants can hold a unified USDC balance across chains and withdraw to any supported network.
- [ ] **CCTP bridge** — let customers pay from Ethereum, Base, or Arbitrum. The contract receives funds on Arc and the customer pays on their preferred chain.
- [ ] **NFC tap to pay** — generate an NFC tag with the payment link for customers to tap instead of scan.
- [ ] **API mode** — a merchant can trigger payment requests from their own backend via a signed message, so ArcReceipt integrates with existing POS software.

---

## How to contribute a feature

1. Pick a frontend-only item from Phase 1 or 2.
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Build and test locally: `bun run dev` then `bun run check`
4. Push: `git push origin feature/your-feature-name`
5. Open a pull request to `main`.

For contract features (Phase 3), read `DEPLOY_NEW_CONTRACT.md` first.

---

## Deciding whether a feature needs a contract change

Ask: does the feature require storing new data onchain, changing who can call a function, or changing how USDC moves? If yes — contract upgrade. If it's display, filtering, export, notifications, or any change to what the UI does with existing onchain data — frontend only.
