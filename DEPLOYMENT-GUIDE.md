# ArcReceipt — Deployment and Mainnet Submission Guide

> This file documents the exact steps required to deploy ArcReceipt to Arc Mainnet
> and prepare the submission package for the grant programme.
>
> **Arc Studio does not execute any of these steps automatically.**
> Every step below requires your explicit action outside Arc Studio.
> Mainnet involves real USDC. Read the full warning in each section before proceeding.

---

## ⚠ Mainnet warning

Transactions on Arc Mainnet involve real funds and are irreversible.
Any code used for mainnet must be independently reviewed, tested, validated,
deployed and operated by you. You are solely responsible for any losses or errors.

Before deploying to mainnet you must:
1. Complete all live wallet tests on testnet (see PENDING.md § C1).
2. Obtain an independent professional Solidity audit of the contract (PENDING.md § C2).
3. Resolve all Critical and High items in PENDING.md.
4. Set `VITE_APP_ORIGIN` to the production domain (PENDING.md § C3).

---

## 1. Network metadata

| Property | Arc Testnet (current) | Arc Mainnet (target) |
|----------|----------------------|---------------------|
| Chain ID | 5042002 | 6414 |
| RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
| USDC address | `0x3600000000000000000000000000000000000000` | Verify at https://developers.circle.com/stablecoins/usdc-on-test-networks before use |
| USDC decimals | 6 | 6 |
| Native gas | USDC (same pool) | USDC (same pool) |

> Always verify the mainnet USDC address against the official Circle developer docs
> at the time of deployment. Do not reuse the testnet address.

---

## 2. Contract deployment

The testnet contract at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` is deployed on
Arc Testnet chain 5042002. **It cannot be used on Arc Mainnet.** You must deploy a
separate contract instance on Arc Mainnet.

### Pre-requisites

- A funded Arc Mainnet wallet (for gas — paid in USDC).
- The audited contract source at `contracts/ArcReceiptCheckout.sol`.
- Foundry installed (`forge`).

### Steps

```bash
# 1. Build (from the project root — not the sandbox)
forge build

# 2. Deploy to Arc Mainnet using your own wallet key
# Replace $PRIVATE_KEY with your deployer private key (never paste into source or chat)
# The USDC address below must be verified against official Circle docs first
forge create contracts/ArcReceiptCheckout.sol:ArcReceiptCheckout \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $PRIVATE_KEY \
  --constructor-args <MAINNET_USDC_ADDRESS> \
  --broadcast \
  --verify

# 3. Record the deployed contract address and deployment transaction hash
# Add them to AGENTS.md and to DEPLOYMENT-GUIDE.md (this file)
```

> Do NOT reuse the testnet deployment block number for the mainnet indexer.
> After deployment, read the block number from the deployment receipt and
> update `src/lib/deployment.ts` → `ARC_MAINNET_DEPLOYMENT.block` before building.

---

## 3. Frontend configuration for mainnet

After deploying the contract:

1. Set these environment variables in Vercel (Settings → Environment Variables):

   | Variable | Value |
   |----------|-------|
   | `VITE_CONTRACT_ADDRESS` | Your deployed mainnet contract address |
   | `VITE_MERCHANT_ADDRESS` | Your merchant wallet address |
   | `VITE_APP_ORIGIN` | Your production domain, e.g. `https://arcreceipt.xyz` |
   | `VITE_CHAIN_ID` | `6414` (Arc Mainnet) |

   > These are read at Vite build time. Changing them requires a rebuild + redeploy.

2. Update `src/config.ts` to include Arc Mainnet and set the default chain to mainnet
   for the production build. The testnet config must remain for the testnet deployment
   so existing testnet links continue working. Use separate Vercel deployments
   (or preview vs production environments) for testnet and mainnet.

3. Update `src/lib/contract.ts` to read `VITE_CHAIN_ID` and `VITE_CONTRACT_ADDRESS`
   from `import.meta.env` so testnet and mainnet share one codebase.

4. Run `bunx vite build` and verify the output before deploying.

5. Confirm `dist/vercel.json` is present after build.

---

## 4. Vercel production security headers

`vercel.json` and `public/vercel.json` already include:

```json
{ "key": "X-Content-Type-Options", "value": "nosniff" },
{ "key": "X-Frame-Options", "value": "DENY" },
{ "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
```

Consider adding for production:

```json
{ "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
{ "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src *; style-src 'self' 'unsafe-inline'; img-src * data:;" }
```

> The `connect-src *` is needed because the app calls multiple public Arc Testnet/Mainnet
> RPC endpoints by design. Tighten to specific origins if you move to a single RPC proxy.

---

## 5. Separate testnet and mainnet cache identities

Testnet and mainnet sessionStorage and localStorage keys already include the chain ID
and contract address:

```
arc-receipt:menu:{chainId}:{contractAddress}:{account}
arc-receipt:cart:{chainId}:{contractAddress}:{account}
```

Because the chain ID and contract address differ between testnet and mainnet,
there is no key collision — a user who has used the testnet app will have a clean
slate on the mainnet app. No migration is needed.

---

## 6. Brave Shields and browser connectivity

If a user reports RPC calls failing with no network errors shown:

- Brave Shields (Brave browser) can block RPC endpoints classified as trackers.
- The app shows a Brave-specific hint in the error state of `PublicCheckout` and
  `PublicReceipt` ("Strict browser content-blocking may block RPC providers").
- Remediation for users: allow `arc.io` and `blockdaemon.com` in Brave Shields, or
  temporarily disable Shields for the app domain.
- The app uses 4-provider fallback (see `src/config.ts`). If all 4 are blocked
  simultaneously, the app cannot reach the chain — this is a known limitation of
  browser-based RPC calls without a backend proxy.

---

## 7. Submission package checklist (grant programme)

Verify each item before submitting. Do not claim acceptance is guaranteed.

### Required evidence

| Item | Status | Notes |
|------|--------|-------|
| Arc Studio project URL | ⬜ | Share from studio.arc.io — shows contract/test/app build |
| Live public app URL (testnet) | ✅ | https://arc-mr.vercel.app |
| Mainnet contract address | ⬜ | Deploy and record after audit |
| Successful real-USDC transaction | ⬜ | Requires mainnet deployment |
| Explorer link for the transaction | ⬜ | From Arc Mainnet explorer |
| Public repo matching release | ⬜ | Push `newthing` branch to GitHub |
| Short video: Studio build + mainnet payment/receipt | ⬜ | 2–3 min screen recording |
| Concise use case description | ⬜ | See §8 below |
| Public GitHub/X/Farcaster profile | ⬜ | Required by grant rules |

### Scoring breakdown (from grant rules)

| Category | Weight | How this app scores |
|----------|--------|---------------------|
| Mainnet USDC | 30% | Requires a real payment on Arc Mainnet |
| Studio use | 25% | All code written in Arc Studio — document this |
| Working product | 25% | Complete payment + receipt flow |
| Potential | 20% | Café/stall/market vendor use case |

---

## 8. Use case description (draft)

> ArcReceipt is a point-of-sale payment and receipt app for small vendors at
> crypto conferences, community markets and food stalls.
>
> A vendor uses the Sell screen to build an order (burger, coffee, etc.), chooses
> an expiry, and creates a USDC payment request onchain with one tap. The customer
> receives a QR code — scanned from any camera — and pays from their own wallet
> in two steps (approve + pay). Every confirmed payment emits a `PaymentRecorded`
> event that is independently verifiable onchain. No backend, no database, no trust
> in the app is required — the contract is the receipt.
>
> Built entirely in Arc Studio using the existing ArcReceipt contract on Arc Testnet.
> The app is deployed at https://arc-mr.vercel.app. Source is on GitHub at
> https://github.com/sharath2525/ArcReceipt.

---

## 9. Deadline and eligibility

- **Deadline:** November 1, 2026 (per attached grant rules).
- **Prior funding:** confirm you have not received prior funding from the same programme.
- **Asset rights:** all images, icons and sounds used must be original or appropriately licensed.
  Sample menu items use emoji (Unicode, no licence required). Image URLs in Settings are
  user-provided — the user is responsible for rights to any custom images they set.
- Arc Studio does not guarantee acceptance into the grant programme.

---

## 10. Steps you must execute manually before submission

In order, after passing live wallet tests and audit:

1. Deploy contract to Arc Mainnet (§2).
2. Record deployed address + deployment block + TX hash.
3. Update `src/lib/deployment.ts` with mainnet deployment block.
4. Update Vercel env vars (§3).
5. Rebuild and redeploy to Vercel.
6. Send a real USDC payment through the mainnet app.
7. Record the payment TX hash and explorer link.
8. Push the branch to GitHub.
9. Record the Arc Studio project URL.
10. Film the demo video.
11. Submit before November 1, 2026.
