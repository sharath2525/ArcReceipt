# ArcReceipt — Usage Guide

## Live URLs
| | URL |
|---|---|
| Production | https://arc-studio-47505b56e0b14c9699dab416.vercel.app |
| Merchant workspace | /merchant |
| Customer checkout | /pay/:requestId |
| Receipt | /receipt/:requestId |
| Verify (wallet-free) | /verify |
| My payments | /payments |

---

## Merchant access

One file controls who sees the merchant workspace:

**`.env`**
```
VITE_MERCHANT_ADDRESS=0xD995d0c31802A8D95C163f875fFefB40AB964eD6
```

### Change the merchant wallet
1. Edit `.env` — replace the address
2. Rebuild and redeploy (see Deploy section)

### Add multiple merchants (allowlist)
1. Edit `.env`:
   ```
   VITE_MERCHANT_ADDRESS=0xFirst...,0xSecond...,0xThird...
   ```
2. Edit `src/lib/merchant.ts` — change the access check to split on commas:
   ```ts
   const allowed = (import.meta.env.VITE_MERCHANT_ADDRESS || '')
     .split(',').map(a => a.trim().toLowerCase())
   // replace single-address check with:
   allowed.includes(address.toLowerCase())
   ```
3. Rebuild and redeploy

> **Note:** This is a frontend UI gate only. The contract allows any wallet to create its own requests directly.

---

## Contract

| | Value |
|---|---|
| Address | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` |
| Chain | Arc Testnet (chain ID 5042002) |
| Deploy block | ~2,900,000 |
| Deploy TX | `0xa464d3b5...` (see `contracts/contract-metadata/ArcReceiptCheckout.json`) |

---

## Local development

```bash
# Install
bun install

# Start dev server
bun run dev

# Lint + typecheck
bash /home/user/arc-studio-helpers/check.sh

# Build
bunx vite build
```

---

## Deploy to Vercel

```bash
# Build first
bunx vite build

# Copy routing config into build output
cp vercel.json dist/vercel.json

# Deploy via Arc Studio chat
# Say: "deploy this to Vercel"
```

Or via Vercel CLI:
```bash
bunx vercel --prod --token YOUR_TOKEN
```

---

## Git workflow

```bash
# Check current branch
git branch

# Switch to feature branch
git checkout newthing

# See what changed
git status
git diff

# Stage and commit
git add -A
git commit -m "feat: describe your change"

# Push to remote
git push origin newthing

# Create a PR (GitHub CLI)
gh pr create --base main --head newthing --title "Part 1-3 features"

# Merge only after live testing — do not auto-merge
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_MERCHANT_ADDRESS` | Yes | Merchant wallet address(es), comma-separated |

No other secrets needed for testnet. For mainnet, add your own RPC endpoint.

---

## Reports scan

- Default: scans last ~300,000 blocks (covers ~1–2 days, enough for all testnet orders)
- Full history: click **"Load full history"** in Reports — scans from block 2,900,000 (~65M blocks, slow)
- Timezone: all reporting is UTC. Midnight UTC = 05:30 IST.

---

## Feature branch status

| Part | Status |
|---|---|
| Part 1 — Layouts, routing, merchant access | Complete |
| Part 2 — Sell flow, checkout, receipts, pending recovery | Complete |
| Part 3 — Today dashboard, Reports, UTC accounting | Complete |
| Live wallet acceptance tests | Pending — requires your wallet |
| Merge to main | **Not yet — run live tests first** |
