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

## Contract Deployment

- Chain: Arc Testnet (5042002)
- Contract: `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`
- Deploy TX: `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45`
- Deployed: 2026-10-16T07:21:04.299Z
- Deployment block: 67,462,931

---

## Merchant Configuration

- Authorized merchant wallet: `0xD995d0c31802A8D95C163f875fFefB40AB964eD6`
- Configured via `.env`: `VITE_MERCHANT_ADDRESS=0xD995d0c31802A8D95C163f875fFefB40AB964eD6`
- This is frontend-only access control. The contract allows any wallet to create its own requests; this gate restricts only the merchant workspace UI.

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
