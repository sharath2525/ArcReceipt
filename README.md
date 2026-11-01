# ArcReceipt

> USDC point-of-sale and receipt system for small vendors — every order has its own QR, every confirmed payment has its own verifiable onchain receipt.

Built with [Arc Studio](https://studio.arc.io)

**Live app:** https://arc-mr.vercel.app
**GitHub:** https://github.com/sharath2525/ArcReceipt

---

## What is ArcReceipt?

ArcReceipt is a crypto point-of-sale app built on Arc — Circle's blockchain where USDC is the native gas token. A merchant creates a payment request onchain, shows the customer a QR code, the customer pays in USDC, and both get a tamper-proof receipt. Every payment term (amount, merchant, expiry, status) is stored onchain — never in a URL, never in a database.

**Real-world use case:** a food stall, coffee cart, or market vendor at a crypto conference. The merchant has their phone open on the Sell screen. A customer scans the QR and pays from their own wallet. The merchant sees the payment confirmed in seconds. No card reader. No bank account. No middleman. USDC goes directly from the customer's wallet to the merchant's wallet.

---

## How it works — step by step

### Merchant creates an order

1. Go to `https://arc-mr.vercel.app/merchant` and connect your merchant wallet (Rabby, MetaMask, etc.)
2. Open the **Sell** tab. Add items from your menu (Burger, Coke, Fries, Coffee) or type a custom USDC amount.
3. Set an expiry — 5 min, 15 min, 30 min, or 1 day.
4. Tap **Create order** and sign one transaction in your wallet.
5. The smart contract stores the amount, your wallet address, and the expiry permanently onchain.
6. A QR code appears. Show it to the customer, or copy the payment link and send it.

### Customer pays

1. Customer scans the QR code or opens the payment link (e.g. `https://arc-mr.vercel.app/pay/42`).
2. The checkout page reads the amount, merchant address, and order status **directly from the contract** — not from the URL. The URL cannot be faked.
3. Customer approves the exact USDC amount (first transaction), then pays (second transaction).
4. USDC moves directly from the customer's wallet to the merchant's wallet. The contract never holds funds.
5. A receipt page is generated at `/receipt/42` showing amount, merchant, payer, and timestamp — all verifiable onchain.

### Merchant sees the payment

1. The Sell screen updates automatically when payment is confirmed.
2. The **Orders** tab shows all requests with status (Open / Paid / Cancelled / Expired).
3. The **Today** tab shows daily totals and a transaction list.
4. The **Reports** tab scans the full onchain history and exports a CSV.

### Anyone can verify

Go to `/verify`, enter any request ID — no wallet needed. The full onchain status is readable by anyone.

---

## Smart contract

The contract (`contracts/ArcReceiptCheckout.sol`) is the only source of truth. There is no backend, no database, no API.

| Property | Detail |
|----------|--------|
| No custody | USDC transfers direct: customer wallet → merchant wallet |
| No owner | No admin, no governance, no pause function |
| No upgradeability | Fixed deployment — nobody can change it |
| Reentrancy guard | OpenZeppelin `ReentrancyGuard` on `pay()` |
| Safe transfer | `SafeERC20.safeTransferFrom` — reverts on failure |
| Self-payment blocked | `pay()` reverts if payer == merchant |
| Expiry enforced | Max 30 days; `pay()` reverts if expired |
| Cancel auth | Only the original merchant can cancel their own request |
| Zero contract balance | Contract never holds USDC |

### Deployed contracts

| Network | Address | Explorer |
|---------|---------|---------|
| Arc Mainnet (chain 5042) | `0x1dABA388EaC463C8C138f23f6D0aC0807d6b6e8C` | [View](https://explorer.arc.io/address/0x1dABA388EaC463C8C138f23f6D0aC0807d6b6e8C) |
| Arc Testnet (chain 5042002) | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` | [View](https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18) |

USDC address (both networks): `0x3600000000000000000000000000000000000000`

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v3 |
| Router | react-router-dom v7 |
| Web3 | wagmi v2, viem v2, ConnectKit |
| Smart contract | Solidity 0.8.28, Foundry (forge) |
| Chain | Arc (mainnet/testnet) — USDC is the native gas token |
| Hosting | Vercel (GitHub auto-deploy) |
| Toasts | Sonner |

---

## App routes

| Route | Who uses it | Description |
|-------|------------|-------------|
| `/merchant` | Merchant | Sell screen — create orders |
| `/merchant/today` | Merchant | Today's sales summary |
| `/merchant/orders` | Merchant | All orders with status |
| `/merchant/orders/:id` | Merchant | Single order detail + QR |
| `/merchant/reports` | Merchant | Full history, CSV export |
| `/merchant/settings` | Merchant | Business name, logo, menu |
| `/merchant/demo` | Merchant | Test the flow without real USDC |
| `/pay/:id` | Customer | Checkout page for request #id |
| `/receipt/:id` | Customer | Receipt for request #id |
| `/payments` | Customer | Customer's own payment history |
| `/verify` | Anyone | Verify any request by ID (no wallet) |

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0 (package manager + runtime)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for contract work only)
- A browser wallet (Rabby or MetaMask) connected to Arc

---

## Local development

```bash
# 1. Clone
git clone https://github.com/sharath2525/ArcReceipt.git
cd ArcReceipt

# 2. Install
bun install

# 3. Set env vars (copy and edit)
cp .env.example .env
# Edit .env — set VITE_MERCHANT_ADDRESS to your wallet address

# 4. Run
bun run dev
# App opens at http://localhost:5173
```

---

## Environment variables

All network config is driven by environment variables. Switching from testnet to mainnet requires only Vercel env var changes — zero code edits.

| Variable | Required | Purpose |
|----------|---------|---------|
| `VITE_MERCHANT_ADDRESS` | Yes | Wallet address(es) allowed to access the merchant dashboard. Comma-separated for multiple. |
| `VITE_APP_ORIGIN` | Yes (production) | Base URL for QR codes and shareable links. Set to your Vercel domain. |
| `VITE_CHAIN_ID` | No (defaults to testnet) | Chain ID: `5042002` = Arc Testnet, `5042` = Arc Mainnet |
| `VITE_CONTRACT_ADDRESS` | No (defaults to testnet) | Deployed ArcReceiptCheckout contract address |
| `VITE_USDC_ADDRESS` | No (defaults to `0x36000…`) | USDC ERC-20 address for this chain |
| `VITE_EXPLORER_BASE` | No (defaults to testnet) | Block explorer base URL (no trailing slash) |
| `VITE_RPC_URL` | No | Optional custom RPC endpoint override |

**These are baked into the JS bundle at build time by Vite.** After changing any of them in Vercel, you must trigger a redeploy. No code changes are needed.

---

## Scripts

```bash
bun run dev              # start local dev server
bun run build            # production build to dist/
bun run check            # lint + typecheck (must pass before pushing)
bun run contracts:build  # compile contracts with forge
bun run contracts:test   # run all Foundry unit tests
```

---

## Deploying to Vercel

The repo is already connected to Vercel at https://arc-mr.vercel.app. Every push to `main` triggers an automatic redeploy.

To connect a new Vercel project:
1. Import `sharath2525/ArcReceipt` in Vercel.
2. Framework preset: **Vite**.
3. Build command: `bun run build` (or `vite build`).
4. Output directory: `dist`.
5. Add env vars (see table above).
6. Deploy.

---

## Pushing changes from Arc Studio

Arc Studio sandbox is on branch `main`. After any change:

```bash
cd /home/user/app && git add -A && git commit -m "describe what changed" && git push
```

Vercel auto-deploys within ~30 seconds.

---

## Contract work

See [`DEPLOY_NEW_CONTRACT.md`](./DEPLOY_NEW_CONTRACT.md) for step-by-step instructions on:
- Building and testing the contract locally
- Deploying a new contract to testnet or mainnet
- Updating the frontend to point to the new contract

See [`FEATURE_ROADMAP.md`](./FEATURE_ROADMAP.md) for the full planned feature list and which items need a new contract vs which are frontend-only.

---

## Security notes

- The merchant address is public configuration — it restricts the frontend UI only. The contract itself allows any wallet to create payment requests.
- Never commit `.env` or any private key to git. Both are in `.gitignore`.
- The contract has no admin functions. If you lose access to your deployer wallet, the contract still runs forever — you just cannot prove you deployed it.
- Before going live with significant funds, get an independent security audit of the contract.

---

## License

MIT
