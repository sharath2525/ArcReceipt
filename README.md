# ArcReceipt

> USDC point-of-sale and receipt verification for small vendors — every order has its own QR, every confirmed payment has its own onchain receipt.

Built with [Arc Studio](https://studio.arc.io)

---

## What it does

A merchant creates a payment request onchain from the Sell screen. The contract generates a unique ID. The merchant shows the customer a QR code. The customer scans it, opens the checkout page in their browser, approves and pays in USDC. Both parties get a verified receipt — amount, merchant address, payer address, and timestamp are all readable directly from the contract. No backend, no database, no custodial wallet.

**Live demo:** https://arc-mr.vercel.app
**Contract:** `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` on [Arc Testnet explorer](https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18)

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v3 |
| Router | react-router-dom v7 (BrowserRouter, path-based) |
| Web3 | wagmi v2, viem v2, ConnectKit |
| Smart contract | Solidity 0.8.28, Foundry (forge) |
| Chain | Arc Testnet (Chain ID 5042002) — USDC is the native gas token |
| Token | USDC · 6 decimals · `0x3600000000000000000000000000000000000000` |
| Toasts | Sonner |

---

## Project structure

```
src/
  components/       UI components (SellPage, PublicCheckout, PublicReceipt, …)
  pages/
    customer/       Pay, Receipt, Verify, My Payments
    merchant/       Today, Orders, Order Detail, Reports, Settings
  lib/              Contract helpers, merchant config, event scanning, pending-tx
  onchain-facts.ts  Chain IDs, USDC address, explorer URL helpers
  onchain-money.ts  USDC parse / format helpers
contracts/
  ArcReceiptCheckout.sol   Main contract
  test/                    Foundry unit tests
```

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract work)
- A browser wallet (MetaMask, Rabby, etc.) connected to Arc Testnet

### Install

```bash
bun install
```

### Environment variables

Create `.env` in the project root:

```
VITE_MERCHANT_ADDRESS=0xYourWalletAddress
VITE_APP_ORIGIN=http://localhost:5173
```

| Variable | Purpose |
|----------|---------|
| `VITE_MERCHANT_ADDRESS` | Comma-separated list of wallet addresses allowed to access the merchant dashboard. Add multiple with commas — no code change needed. |
| `VITE_APP_ORIGIN` | Base URL used when building shareable payment and receipt links. Set to your deployed domain in production. |

Both variables are baked into the JS bundle at build time by Vite. After changing either one you must rebuild and redeploy.

### Run locally

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Lint and typecheck

```bash
bun run check
```

### Contract: build and test

```bash
bun run contracts:build   # forge build
bun run contracts:test    # forge test
```

---

## Deployment (Vercel)

1. Set `VITE_MERCHANT_ADDRESS` and `VITE_APP_ORIGIN` in Vercel → Settings → Environment Variables.
2. Deploy. The frontend reads contract state from public Arc Testnet RPC — no backend or API key is needed.

See `DEPLOYMENT-GUIDE.md` for the full mainnet checklist (requires an independent audit before going live with real funds).

---

## How it works

### Merchant flow

1. Open `/merchant` with a configured wallet connected.
2. Build an order in the Sell screen — select menu items or enter a custom USDC amount, set an expiry.
3. Sign one transaction in your wallet. The contract stores the amount, merchant address, and expiry onchain.
4. Show the customer the QR code or share the payment link.

### Customer flow

1. Scan the QR or open the payment link.
2. The checkout page reads amount, merchant, and status directly from the contract — not from the URL.
3. Approve the exact USDC amount, then pay. Both steps are separate wallet transactions.
4. A verified receipt page is generated. The `PaymentRecorded` event in the transaction is independently verifiable on the explorer.

### Verification (wallet-free)

Anyone can go to `/verify`, enter a request ID, and see the full onchain status — no wallet connection required.

---

## Smart contract

**No owner. No admin. No upgradeability.**

The contract is a fixed, non-upgradeable deployment. Nobody — not the deployer, not Circle, not Arc Studio — can pause, modify, or drain it. USDC flows directly from customer wallet to merchant wallet; the contract balance is always zero.

| Property | Detail |
|----------|--------|
| No custody | USDC transfers direct: customer → merchant |
| No owner | No `Ownable`, no admin, no governance |
| Reentrancy guard | `pay()` uses OpenZeppelin `ReentrancyGuard` |
| Safe transfer | `SafeERC20.safeTransferFrom` — reverts on failure |
| Self-payment blocked | `pay()` reverts if `msg.sender == merchant` |
| Expiry enforced | Max 30 days; `pay()` reverts after expiry |
| Cancel auth | Only the original merchant can cancel |

---

## Future scope

Features not built for the hackathon but planned for a production version:

- **Mainnet deployment** — deploy a new contract instance to Arc Mainnet after an independent security audit; update `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` in source.
- **Indexed event backend** — replace the in-browser `getLogs` scan with a lightweight indexer (e.g. Ponder, The Graph, or a simple Express + viem poller) to make My Payments and Reports instant regardless of history length.
- **Delivery and fulfillment tracking** — add an optional off-chain fulfilment status alongside each order (no contract change needed; a signed off-chain record keyed by request ID suffices).
- **Loyalty and rewards** — merchant-defined discount codes or repeat-customer rewards based on verified payment history.
- **Refund flow** — merchant-initiated USDC refund via a new `refund(id)` contract method; the original amount is returned to `req.payer`.
- **Cross-device sync** — replace browser-local cart and menu storage with an optional wallet-signed sync endpoint so the same menu loads on any device.
- **WhatsApp / SMS receipt delivery** — post-payment webhook that sends the receipt link to a phone number collected at checkout.
- **Multi-currency support** — accept EURC or other Circle-supported stablecoins via a token-parameter extension to `createRequest`.
- **Receipt QR at point of sale** — print-optimised receipt page with a QR linking back to the onchain proof, suitable for thermal receipt printers.

---

## License

MIT
