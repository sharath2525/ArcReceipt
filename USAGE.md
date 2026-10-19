# ArcReceipt — Usage Guide

## Live URLs

| | URL |
|---|---|
| Production (stable) | https://arc-studio-47505b56e0b14c9699dab416.vercel.app |
| Home | / |
| Merchant workspace | /merchant |
| Merchant sell | /merchant/sell |
| Today dashboard | /merchant/today |
| Orders | /merchant/orders |
| Reports | /merchant/reports |
| Settings + menu | /merchant/settings |
| Customer checkout | /pay/:requestId |
| Receipt | /receipt/:requestId |
| Verify (wallet-free) | /verify |
| My payments | /payments |

---

## Merchant access

One variable controls who sees the merchant workspace:

**`.env`**
```
VITE_MERCHANT_ADDRESS=0xD995d0c31802A8D95C163f875fFefB40AB964eD6
```

### Change the merchant wallet
1. Edit `.env` — replace the address
2. Rebuild and redeploy (see Deploy section below)

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

> **Note:** This is a frontend UI gate only. The contract allows any wallet to
> create its own payment requests directly on-chain regardless of this setting.

---

## Contract

| | Value |
|---|---|
| Address | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` |
| Chain | Arc Testnet (chain ID 5042002) |
| Deploy block | 67,462,931 (source: `src/lib/deployment.ts`) |
| Deploy TX | `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45` |
| Explorer | https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18 |

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

# Copy routing config into build output (required before every deploy)
cp vercel.json dist/vercel.json
```

---

## Deploy to Vercel

```bash
# 1. Build
bunx vite build

# 2. Copy routing config (REQUIRED — fixes /merchant and all deep links)
cp vercel.json dist/vercel.json

# 3. Deploy via Arc Studio chat — say: "deploy this to Vercel"
#    OR via Vercel CLI:
bunx vercel --prod --token YOUR_TOKEN
```

After deploying, Vercel gives you two URLs:
- **Stable alias** (e.g. `arc-studio-...416.vercel.app`) — updates on every deploy
- **Unique deploy URL** (e.g. `arc-studio-...416-abc123.vercel.app`) — permanent snapshot

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

# Stage and commit ALL changes (including unstaged)
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
| `VITE_APP_ORIGIN` | Recommended | Full public URL (e.g. `https://yourdomain.com`) — used for QR code links and CSV exports |

No other secrets needed for testnet. For mainnet, add your own RPC endpoint.

---

## Reports scan

- Default: scans the most recent ~300,000 blocks (covers ~1–2 days, enough for all testnet orders)
- Newest-first: today's payments appear after the very first scan chunk (~1–2 seconds)
- Full history: click **"Load full history"** in Reports — scans from block 67,462,931 (~65M blocks, takes several minutes)
- Timezone: all reporting is UTC. Midnight UTC = 05:30 IST.

---

## Q&A — Common scenarios

### Q: I changed my Vercel URL / redeployed and got a new URL. What do I need to update?

**Short answer: Nothing.** QR codes and payment links automatically use `window.location.origin` — whatever domain the app is currently running on. No config change needed.

`VITE_APP_ORIGIN` is intentionally left unset in `.env`. Do not set it unless you have a specific reason (e.g. server-side rendering where `window` is not available).

**What does NOT break when you change the URL:**
- QR codes — always generated from the current domain automatically
- Payment links — same
- On-chain payment verification — works from any URL
- The contract address — never changes

**What about old QR codes / links already shared?**
- They contain the old URL and will only work if the old deployment is still live
- Customers can always type the request ID at `/verify` or paste the link into the home page search box — the contract lookup works regardless of domain

---

### Q: `/merchant` gives a 404 on Vercel but `/` works fine.

This means `vercel.json` was not included in the deployed `dist/` folder.

Fix:
```bash
cp vercel.json dist/vercel.json
# Then redeploy
```

The `vercel.json` rewrite rule sends all routes to `index.html` so React Router can handle them. Without it, only `/` works (because Vercel serves `index.html` as the root by default).

**Permanent fix:** `vercel.json` is now also in the `public/` folder so Vite copies it to `dist/` automatically on every build. If you see this again, check that `public/vercel.json` exists.

---

### Q: `git merge` fails with "Your local changes would be overwritten".

You have uncommitted changes on the current branch. Fix:
```bash
# Commit the changed file(s) first
git add -A
git commit -m "fix: commit before merge"

# Then merge
git merge --no-ff newthing
```

If git opens an editor and gets stuck (no editor configured):
```bash
git commit --no-edit
```

---

### Q: `git push` says "Everything up to date" but I just made changes.

You staged files with `git add` but did not commit yet. Run:
```bash
git add -A
git commit -m "your message"
git push origin newthing
```

---

### Q: I want to use a custom domain instead of the Vercel URL.

1. Add your domain in the Vercel dashboard under Project → Settings → Domains
2. Update `VITE_APP_ORIGIN` in `.env` to your custom domain:
   ```
   VITE_APP_ORIGIN=https://receipts.yourbusiness.com
   ```
3. Rebuild and redeploy

---

### Q: The scan shows "totals incomplete / some records may be missing".

This is normal during the first load — the scanner is still working through historical blocks.
- Wait for the scan to finish (the progress updates live)
- The newest-first approach means today's payments appear almost immediately; older history fills in over the next few minutes
- If the warning persists after scanning finishes, click "Retry" to re-attempt failed ranges
- Rate-limit errors are handled automatically with retries and a 450ms delay between chunks

---

### Q: I want to update the menu items / prices.

Go to **Merchant workspace → Settings**. From there you can:
- Add, edit, remove, and reorder items
- Toggle item availability (hidden items do not appear on the Sell screen)
- Set a custom image URL for any item (paste any `https://` image link)
- Reset to the sample menu

Menu data is stored in your browser's `localStorage`, scoped to your wallet and contract. It is not synced across devices.

---

### Q: Cart is empty after midnight / browser restart.

Cart drafts are stored in `sessionStorage` and survive tab refreshes but not full browser restarts or midnight session expiry. This is intentional — submitted orders are permanent on-chain, but unsent drafts are transient. Simply rebuild the cart from the menu.

---

### Q: A customer says the QR code doesn't work / payment link is broken.

1. Check that `VITE_APP_ORIGIN` is set to the correct deployed URL
2. Check that the request has not expired (the expiry is shown on the order page)
3. The customer can also type the request ID directly at `/verify` or paste the link into the home page search box
4. Payment terms (amount, merchant) are always read from the contract, never from the URL — so even a partial URL works as long as the request ID is present

---

### Q: I see "rate limit exceeded" errors in the Tracing panel.

The public Arc Testnet RPC has a rate limit. The scanner handles this automatically:
- Calls are serialised (not parallel) within each chunk
- A 450ms delay between chunks prevents hitting the limit
- Failed chunks are automatically retried up to 3 times with exponential backoff
- If a range fails permanently, it is shown in the Reports page with a "Retry" button

If you are seeing frequent rate limit errors, the RPC may be under load. Wait a few minutes and click Retry.

---

## Feature branch status

| Part | Status |
|---|---|
| Part 1 — Data correctness (events, deployment block, cache, parseUsdc) | Complete |
| Part 2 — Home page, sell layout, order presentation, checkout, navigation | Complete |
| Part 3 — Today dashboard drill-downs, Reports table/chart/export, print | Complete |
| Rate-limit fix (serialised getLogs + 450ms inter-chunk delay) | Complete |
| Live wallet acceptance tests (P1T-1 through P3T-8) | Pending — requires testnet wallet |
| Merge to main | **Not yet — run live tests first** |
