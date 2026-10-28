# ArcReceipt

> Built with Arc Studio - money-powered apps in minutes

USDC checkout and payment-receipt app for small vendors at crypto conferences.
Product promise: "Every order has its own QR. Every confirmed payment has its own receipt."

---

## What This App Does

Merchant creates USDC payment requests onchain → customer scans QR → pays with USDC → both get a verified receipt. All payment terms (amount, merchant, expiry, status) are read from the deployed smart contract — never from URLs or local storage.

---

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Router: react-router-dom v7 (BrowserRouter, path-based routes)
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, Rabby, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals, Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

---

## Contract

### Who created it and who owns it

Arc Studio wrote the Solidity source (`contracts/ArcReceiptCheckout.sol`) and deployed it to Arc Testnet during the initial session. The deployer wallet paid the gas — after that it has zero special rights. The contract has **no owner, no admin, no upgradeability**. Nobody — not you, not Arc Studio, not Circle — can pause, modify, or upgrade it. It runs exactly as deployed, forever.

### Deployed instance (Arc Testnet)

| Field | Value |
|-------|-------|
| Contract address | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` |
| Chain | Arc Testnet (chain ID 5042002) |
| Deploy TX | `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45` |
| Deployed | 2026-10-16T07:21:04 UTC |
| Deployment block | 67,462,931 |
| Explorer | https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18 |
| USDC (hardcoded) | `0x3600000000000000000000000000000000000000` (6 decimals, Arc Testnet) |

### What the contract does (plain language)

- Any wallet can call `createRequest(amount, expiresAt)` to create a payment request. The caller becomes the merchant for that request.
- Any other wallet can call `pay(requestId)` to pay it. The contract checks: request is open, not expired, payer is not the merchant. Then it calls `USDC.transferFrom(payer, merchant, amount)` — USDC moves directly from customer to merchant. The contract never holds funds.
- The merchant can call `cancelRequest(id)` at any time while the request is still open.
- `getRequest(id)` returns the full request struct (merchant, amount, expiresAt, status, payer, paidAt).
- `getMerchantRequests(merchant, offset, limit)` returns paginated request IDs for a merchant.

### Security properties

| Property | Detail |
|----------|--------|
| No custody | USDC goes direct from customer to merchant. Contract balance is always zero. |
| No owner | No `owner`, no `Ownable`, no admin role. Nobody can pause or change it. |
| No upgradeability | Not a proxy. Code is fixed at deployment. |
| Reentrancy guard | `pay()` uses OpenZeppelin `ReentrancyGuard` (`nonReentrant` modifier). |
| Safe transfer | Uses OpenZeppelin `SafeERC20.safeTransferFrom` — reverts on failed transfer. |
| Self-payment blocked | `pay()` reverts with `SelfPayment` if `msg.sender == req.merchant`. |
| Expiry enforced | `pay()` reverts with `RequestExpired` if `block.timestamp >= req.expiresAt`. |
| Max expiry window | Requests cannot be created with expiry more than 30 days in the future. |
| Cancel auth | Only the original merchant (`msg.sender == req.merchant`) can cancel. |
| Isolation | Completely separate from every other contract. Another project's contract cannot interact with it. |

### How to deploy a new contract (if you ever need one)

You would need a new deployment if you want to change the contract logic (e.g. add a new feature, change the USDC address for mainnet, fix a bug). Steps:

1. Edit `contracts/ArcReceiptCheckout.sol` with the changes.
2. Run `forge build` to compile.
3. Run `forge test` — all tests must pass.
4. Get an independent audit if the change handles real funds.
5. Deploy: say "deploy the contract" in Arc Studio chat — it will deploy to Arc Testnet and give you the new address.
6. Update `src/lib/contract.ts`: change `CONTRACT_ADDRESS` to the new address.
7. Update `src/lib/deployment.ts`: change `DEPLOYMENT_BLOCK` to the new deploy block.
8. Update `AGENTS.md` and `USAGE.md` with the new address and block.
9. Rebuild and redeploy the frontend.

**The existing testnet contract keeps working in parallel** — old payment links still resolve. Only new orders use the new contract.

For mainnet: follow `DEPLOYMENT-GUIDE.md` — independent audit is required before any mainnet deployment.

---

## Environment Variables

Only two `VITE_` variables exist in the entire codebase. Both must be set in Vercel AND in the sandbox `.env` before building.

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_MERCHANT_ADDRESS` | Comma-separated list of wallet addresses that can access the merchant workspace. One address or many — all equal. | `0xAbc...123` or `0xAbc...123,0xDef...456` |
| `VITE_APP_ORIGIN` | Base URL used when building shareable payment/receipt links and QR codes. | `https://arc-mr.vercel.app` |

**Important:** `VITE_*` variables are baked into the JS bundle at Vite build time. Changing them in Vercel's dashboard does NOT update the live site until you also rebuild and redeploy. Workflow:
1. Update the value in Vercel dashboard (Settings → Environment Variables).
2. Update the same value in the sandbox `.env` file (Code panel).
3. Rebuild and redeploy (say "redeploy" in the chat, or use Vercel dashboard → Deployments → Redeploy).

No other environment variables are needed. Contract address, USDC address, chain ID, RPC endpoints, and deployment block are all hardcoded in source — not env vars — because changing them silently would break payments.

## Merchant Configuration

- Authorized merchant wallets: configured via `VITE_MERCHANT_ADDRESS` (comma-separated list).
- Frontend-only access control. The contract allows any wallet to create its own requests; this gate restricts only the merchant workspace UI.
- To add a wallet: update `VITE_MERCHANT_ADDRESS` in Vercel + sandbox `.env`, then redeploy. No code change needed.

---

## Route Map (current — updated Stages 1/2/3)

### Customer routes (CustomerLayout — narrow mobile)
| Path | Component | Notes |
|------|-----------|-------|
| `/` | HomePage | Lookup + how-it-works. No merchant links. |
| `/pay/:requestId` | PublicCheckout | Customer payment flow |
| `/receipt/:requestId` | PublicReceipt | Wallet-free receipt + Copy/Print |
| `/payments` | MyReceipts | Connected wallet history; Retry/Update/Rebuild |
| `/verify` | VerifyPage | Wallet-free receipt lookup by ID |

### Merchant routes (MerchantLayout — sidebar, wallet-gated)
| Path | Component | Notes |
|------|-----------|-------|
| `/merchant` | MerchantSellPage → SellPage | Cart POS; localStorage menu |
| `/merchant/today` | MerchantTodayPage | UTC daily summary; contract-first totals |
| `/merchant/orders` | MerchantOrdersPage | Paginated order history |
| `/merchant/orders/:requestId` | MerchantOrderDetailPage | QR + status; merchant-scoped guard |
| `/merchant/reports` | MerchantReportsPage | Daily/monthly; adaptive scan; CSV |
| `/merchant/settings` | MerchantSettingsPage | Menu + business profile; localStorage |
| `/merchant/demo` | MerchantDemoPage | Developer tool, not in main nav |

### Legacy redirects (backward compatibility)
| Old URL | Redirects to |
|---------|-------------|
| `/?request=N` | `/pay/N` |
| `/?request=N&view=receipt` | `/receipt/N` |
| `/?view=orders` | `/merchant/orders` |
| `/?view=my-receipts` | `/payments` |
| `/?view=verify` | `/verify` |
| `/?view=sell` | `/merchant` |

---

## Key Files

**Routing and layouts**
- `src/AppRouter.tsx` — route tree, two layout trees
- `src/components/MerchantLayout.tsx` — sidebar nav, access gate wrapper
- `src/components/MerchantGate.tsx` — access control component
- `src/components/CustomerLayout.tsx` — narrow mobile shell; no merchant links
- `src/pages/LegacyRedirect.tsx` — backward-compatible query-string redirect

**Contract and wallet**
- `src/lib/contract.ts` — contract address, ABI, topics, canonical link builders
- `src/lib/merchant.ts` — merchant address config and access state
- `src/lib/pending-tx.ts` — pending TX sessionStorage persistence
- `src/lib/deployment.ts` — deployment block constant (67,462,931)
- `src/config.ts` — wagmi config with 4-provider RPC fallback

**Data / scanning (Stage 2)**
- `src/lib/use-event-history.ts` — adaptive-chunk event scanner; tail-refresh; parallel getLogs
- `src/lib/use-merchant-requests.ts` — paginated contract reads; pinned reference block
- `src/lib/utc-periods.ts` — UTC period helpers incl. `previousMonthStart`

**Pages**
- `src/pages/HomePage.tsx` — public landing; lookup; how-it-works; no merchant links
- `src/components/PublicCheckout.tsx` — payment flow; PaymentRecorded validation
- `src/components/PublicReceipt.tsx` — receipt; TX recovery; Copy/Print
- `src/components/MyReceipts.tsx` — payment history; generation-safe scan; Retry/Update/Rebuild
- `src/pages/merchant/MerchantTodayPage.tsx` — contract-first daily totals
- `src/pages/merchant/MerchantReportsPage.tsx` — historical reporting; CSV export
- `src/pages/merchant/MerchantSettingsPage.tsx` — menu (localStorage) + business profile

**Docs**
- `USAGE.md` — complete operator guide (17 sections + stage history)
- `PENDING.md` — open issues, live tests still required, invariants
- `IMPLEMENTATION-SPEC.md` — full spec Parts 1/2/3 + stage checklists
- `DEPLOYMENT-GUIDE.md` — mainnet deploy steps, security headers, grant submission checklist

---

## To Run

```bash
bun install
bun run dev
```

Add `VITE_MERCHANT_ADDRESS=0xD995d0c31802A8D95C163f875fFefB40AB964eD6` to `.env`.
