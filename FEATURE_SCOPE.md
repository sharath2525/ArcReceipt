# ArcReceipt — Feature Scope

> Features not in the hackathon build. Planned for a production version.
> Move an item to the project board / milestone when work starts on it.

---

## Phase 1 — Production readiness

### Mainnet deployment
Deploy a new contract instance to Arc Mainnet after an independent security audit.
Update `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` in `src/lib/contract.ts` and `src/lib/deployment.ts`.
Follow the full checklist in `DEPLOYMENT-GUIDE.md`.

### Indexed event backend
Replace the in-browser `getLogs` scan with a lightweight indexer (Ponder, The Graph, or a simple
Express + viem poller). Makes My Payments and Reports pages instant regardless of wallet history
length. No contract change needed — purely a data layer swap.

---

## Phase 2 — Merchant productivity

### Cross-device menu sync
Replace `localStorage` menu storage with an optional wallet-signed sync endpoint.
Same menu loads on any device the merchant logs in from — no manual re-entry.
Cart stays session-local by design.

### Delivery and fulfilment tracking
Add an optional off-chain fulfilment status alongside each order.
No contract change needed — a signed off-chain record keyed by request ID is enough.
Display in the merchant Orders view as a "Fulfilled / Ready / Pending" badge.

### Receipt printer QR
Print-optimised receipt page with a QR linking back to the onchain proof.
Suitable for thermal receipt printers. Extend the existing `@media print` CSS in `src/index.css`.

---

## Phase 3 — Customer experience

### WhatsApp / SMS receipt delivery
Post-payment webhook that sends the receipt link (`/receipt/:id`) to a phone number
collected at checkout. Requires a server-side relay (Twilio or similar) — no contract change.

### Loyalty and rewards
Merchant-defined discount codes or repeat-customer rewards based on verified onchain payment
history. Discount applied as a price reduction before `createRequest` is called — the reduced
amount is what goes onchain, so the contract needs no changes.

### Refund flow
Merchant-initiated USDC refund via a new `refund(id)` contract method.
The original amount is returned from the merchant wallet to `req.payer`.
**Requires a contract upgrade and a new deployment** — the current contract has no refund function.
Run a full audit before deploying a contract that holds or moves funds on the merchant's behalf.

---

## Phase 4 — Multi-currency and DeFi

### Multi-currency support
Accept EURC or other Circle-supported stablecoins by adding a `token` parameter to
`createRequest`. The contract would call `IERC20(token).transferFrom(...)` instead of the
hardcoded USDC address.
**Requires a contract upgrade.**

### Savings / yield on float
Route idle USDC held in the merchant wallet into a yield-bearing vault (e.g. Morpho, Aave on Arc)
between orders. Entirely off-contract — the merchant wallet interacts with the vault directly.

---

## Notes

- Items marked **Requires a contract upgrade** need a new deployment and a fresh independent audit.
- Items with no such note can be shipped as frontend-only changes against the current deployed contract.
- The current contract address (`0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`) is immutable — no
  owner, no proxy, no upgradeability. All logic changes require a new deployment.
