# Deploying a New Contract

Use this guide whenever you need to deploy a new or upgraded version of `ArcReceiptCheckout.sol`. This covers both testnet (for testing) and mainnet (for production).

---

## When do you need a new contract?

- You changed `contracts/ArcReceiptCheckout.sol` (added a function, changed logic, fixed a bug)
- You want to deploy to a new chain
- You want a fresh contract with no existing state (e.g. for a major version upgrade)

**You do NOT need a new contract for:**
- Any frontend change
- Changing the merchant wallet address
- Switching the UI between testnet and mainnet (use `VITE_CONTRACT_ADDRESS` env var)
- Adding menu items, changing prices, or updating business settings

---

## Prerequisites

### 1. Install Foundry (one-time setup)

Foundry is the tool that compiles and deploys the Solidity contract.

```bash
curl -L https://foundry.paradigm.xyz | bash
```

Close and reopen your terminal, then:

```bash
foundryup
```

Verify:

```bash
forge --version
# Should print: forge Version: X.X.X ...
```

### 2. Clone the repo (if not already)

```bash
git clone https://github.com/sharath2525/ArcReceipt.git
cd ArcReceipt
```

### 3. Install Foundry dependencies

```bash
forge install
```

This downloads `lib/forge-std` and OpenZeppelin into the `lib/` folder.

### 4. Get your deployer wallet private key

This is the wallet that will sign the deployment transaction. You need:
- The private key (from Rabby: Settings → Export Private Key, or MetaMask: Account Details → Export Private Key)
- USDC in that wallet to pay for gas (on Arc, USDC IS the gas token)

**Never share or commit your private key.** Store it only in your terminal session as an env var.

---

## Step 1 — Edit the contract (if needed)

The contract source is at `contracts/ArcReceiptCheckout.sol`.

After editing, run:

```bash
forge build
```

Fix any compilation errors before continuing. The output is in `contracts/out/`.

---

## Step 2 — Run the tests

Always run tests before deploying. The test suite covers all contract logic.

```bash
forge test
```

All tests must pass (0 failures). If any fail, fix the contract before continuing.

To run tests with verbose output:

```bash
forge test -vvv
```

---

## Step 3 — Deploy to Arc Testnet (always test here first)

```bash
forge create contracts/ArcReceiptCheckout.sol:ArcReceiptCheckout \
  --rpc-url https://rpc.testnet.arc.io \
  --private-key YOUR_PRIVATE_KEY_HERE \
  --broadcast
```

**Output you will see:**

```
Deployer: 0xYourWalletAddress
Deployed to: 0xNEW_TESTNET_CONTRACT_ADDRESS   ← copy this
Transaction hash: 0xTX_HASH                   ← copy this
```

**Save both values.**

Verify on the explorer:
```
https://explorer.testnet.arc.io/tx/0xTX_HASH
```

---

## Step 4 — Test the frontend against the new testnet contract

1. Open `.env` in the project root.
2. Set:
   ```
   VITE_CHAIN_ID=5042002
   VITE_CONTRACT_ADDRESS=0xNEW_TESTNET_CONTRACT_ADDRESS
   VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
   VITE_EXPLORER_BASE=https://explorer.testnet.arc.io
   ```
3. Restart the dev server:
   ```bash
   bun run dev
   ```
4. Test the full flow: create an order, pay from a second wallet, verify the receipt.

---

## Step 5 — Deploy to Arc Mainnet

Only do this after the testnet version is working correctly.

```bash
forge create contracts/ArcReceiptCheckout.sol:ArcReceiptCheckout \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key YOUR_PRIVATE_KEY_HERE \
  --broadcast
```

**Output:**

```
Deployer: 0xYourWalletAddress
Deployed to: 0xNEW_MAINNET_CONTRACT_ADDRESS   ← copy this
Transaction hash: 0xTX_HASH                   ← copy this
```

Verify on the explorer:
```
https://explorer.arc.io/tx/0xTX_HASH
```

---

## Step 6 — Update the frontend deployment block

The event scanner needs to know which block to start scanning from. Scanning from block 0 on a live chain takes a very long time.

Open `src/lib/deployment.ts` and add (or update) the mainnet deployment record:

```typescript
export const ARC_MAINNET_DEPLOYMENT: DeploymentRecord = {
  chainId: 5042,
  contractAddress: '0xNEW_MAINNET_CONTRACT_ADDRESS',
  txHash: '0xTX_HASH',
  block: YOUR_DEPLOY_BLOCK_NUMBER_HERE,  // get this from the explorer
  deployedAt: 'YYYY-MM-DDTHH:MM:SS.000Z',
}
```

To find the deployment block number: look up the deploy TX on `https://explorer.arc.io` and read the Block field.

---

## Step 7 — Update Vercel environment variables

Go to: **https://vercel.com → arc-mr project → Settings → Environment Variables**

Update these 4 variables:

| Variable | New value |
|----------|----------|
| `VITE_CHAIN_ID` | `5042` (mainnet) or `5042002` (testnet) |
| `VITE_CONTRACT_ADDRESS` | New contract address from Step 5 |
| `VITE_USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` |
| `VITE_EXPLORER_BASE` | `https://explorer.arc.io` (mainnet) or `https://explorer.testnet.arc.io` (testnet) |

---

## Step 8 — Update AGENTS.md

Record the new deployment in `AGENTS.md` so future sessions have the correct addresses:

```markdown
| Contract address | `0xNEW_ADDRESS` |
| Chain | Arc Mainnet (chain ID 5042) |
| Deploy TX | `0xTX_HASH` |
| Deployment block | YOUR_BLOCK_NUMBER |
```

---

## Step 9 — Commit and push

```bash
cd /home/user/app
git add -A
git commit -m "deploy new contract: 0xNEW_ADDRESS on Arc Mainnet"
git push
```

Vercel will rebuild with the new env vars and the updated `deployment.ts`.

---

## Step 10 — Verify the live app

1. Open https://arc-mr.vercel.app
2. Confirm the network banner shows the correct chain.
3. Create a test order and confirm it appears.
4. Pay from a second wallet and confirm the receipt shows correctly.
5. Check the Reports page scans from the new deployment block.

---

## Checklist summary

- [ ] Contract edited (if needed)
- [ ] `forge build` — no errors
- [ ] `forge test` — all tests pass
- [ ] Deployed to testnet — saved address + TX hash
- [ ] Tested frontend against testnet contract
- [ ] Deployed to mainnet — saved address + TX hash
- [ ] `src/lib/deployment.ts` updated with new block number
- [ ] Vercel env vars updated (4 variables)
- [ ] `AGENTS.md` updated
- [ ] Committed and pushed to GitHub
- [ ] Live app verified end-to-end

---

## Arc RPC endpoints

| Network | RPC URL | Explorer |
|---------|---------|---------|
| Arc Mainnet | `https://rpc.mainnet.arc.io` | `https://explorer.arc.io` |
| Arc Testnet | `https://rpc.testnet.arc.io` | `https://explorer.testnet.arc.io` |

---

## USDC address (same on both Arc networks)

`0x3600000000000000000000000000000000000000` — 6 decimals (ERC-20 view)

On Arc, USDC is also the native gas token. You do not need ETH or any other token to pay gas. USDC in your wallet covers everything.

---

## Troubleshooting

**`forge: command not found`**
Run `foundryup` again and make sure `~/.foundry/bin` is in your PATH.

**`insufficient funds`**
Your deployer wallet has no USDC on this network. Bridge USDC to Arc from another chain using https://bridge.arc.io, or get testnet USDC from the Arc Studio sidebar ("Get test USDC").

**`nonce too low` or `replacement transaction underpriced`**
A previous transaction is stuck. Wait a few seconds and try again.

**`Error: could not detect network`**
The RPC URL is wrong or temporarily down. Try again, or use a different RPC: check https://docs.arc.io for the current endpoint list.

**Vercel still shows old contract after deploy**
Make sure you triggered a full rebuild (not just a redeployment of the old bundle). In Vercel, go to Deployments → three dots → Redeploy → turn off "Use existing Build Cache".
