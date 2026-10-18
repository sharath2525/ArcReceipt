# ArcReceipt Checkoutt — Build Log

**Project:** ArcReceipt Checkout
**Program:** Arc Microgrants: Built with Arc Studio
**Date started:** 2026-10-16
**Phase:** Day 2 complete / Day 3 in progress
**Status heading note:** Day 1 requirements R37–R40 remain NOT VERIFIED (no payment has been executed through the contract yet). This heading will be updated only when payment evidence exists.

---

## 1. Chain Configuration (Verified from Arc Studio onchain-facts registry)

| Property | Value | Source |
|---|---|---|
| Arc Testnet Chain ID | 5042002 | `src/onchain-facts.ts` (Arc Studio registry) |
| Arc Mainnet Chain ID | 5042 | `src/onchain-facts.ts` |
| Arc Testnet RPC | `https://rpc.testnet.arc.io` | `src/onchain-facts.ts` |
| Arc Testnet Explorer | `https://explorer.testnet.arc.io` | `src/onchain-facts.ts` |
| USDC ERC-20 Address (testnet) | `0x3600000000000000000000000000000000000000` | `src/onchain-facts.ts` |
| USDC ERC-20 Address (mainnet) | `0x3600000000000000000000000000000000000000` | `src/onchain-facts.ts` |
| USDC ERC-20 Decimals | **6** | `src/onchain-facts.ts` |
| Native Gas Symbol | USDC | `src/onchain-facts.ts` (nativeCurrency.isUsdc = true) |
| Native Gas Decimals | **18** | `src/onchain-facts.ts` |

### ERC-20 vs Native Decimal Distinction

On Arc, the **same underlying asset** is exposed two ways:
- **ERC-20 view** (token transfers, allowances, this contract): 6 decimals. `1.00 USDC = 1_000_000`.
- **Native gas view** (`msg.value`, wallet gas balance): 18 decimals. `1.00 USDC = 10^18`.

The contract operates only in 6-decimal ERC-20 units. It is non-payable. These two views must never be summed or displayed as separate balances — doing so double-counts the same pool.

---

## 2. Pinned Dependencies

| Dependency | Version | Evidence |
|---|---|---|
| Solidity compiler | 0.8.28 | `foundry.toml` `solc_version = "0.8.28"`, `auto_detect_solc = false` |
| EVM target | Paris | `foundry.toml` `evm_version = "paris"` |
| `@openzeppelin/contracts` | 5.1.0 | `package.json` (pinned exact; NOT `^5.x`) |
| forge-std | 1.16.2 | `lib/forge-std/package.json` `"version": "1.16.2"` (read 2026-10-16) |

**Why Paris + OZ 5.1.0:** Arc rejects the PUSH0 opcode. OZ ≥ 5.2.0 imports `Bytes.sol` which uses the Cancun-only `mcopy` opcode. 5.1.0 is the newest OZ release that is fully Paris-safe.

**forge-std note:** forge-std is installed as a directory under `lib/`, not as a git submodule (no `.gitmodules`). No git commit hash is available; version 1.16.2 is the `package.json` value. This is a limitation of the sandbox install method.

---

## 3. Contract Source

**File:** `contracts/ArcReceiptCheckout.sol`
**SPDX:** MIT
**Source SHA-256 (verified 2026-10-16):** `87b9c9a410ba3581358561f00ac25879d89b1f33501d03171dd6d6829d0f064b`
**Command:** `sha256sum contracts/ArcReceiptCheckout.sol`

### Direct-Payment Property (correction from previous log)

The contract performs **direct payer→merchant transfers** — funds never sit in the contract. It is accurate to say that normal payment flows leave the contract balance at zero. However, anyone can send USDC directly to the contract address via a standard ERC-20 `transfer()` call outside of `pay()` — such unsolicited deposits would remain locked with no withdrawal mechanism. This does not affect correctness of payments, and the invariant test `invariant_noCustody` verifies zero balance only under normal operation (all calls routed through the contract's own functions).

### Key Design Decisions

- USDC address hardcoded as `immutable` — `0x3600000000000000000000000000000000000000`. No admin setter.
- IDs start at 1. ID 0 is always `RequestNotFound`.
- `pay()` follows strict CEI. If `safeTransferFrom` reverts, the state write is atomically rolled back.
- No owner, no admin, no upgradeability, no fee, no personal data.

---

## 4. Security Review

**Review level:** max (Critical + High + Medium + Low)
**Date:** 2026-10-16

**Important:** This is an internal review using Studio's analysis tooling. It is NOT a paid third-party audit and does not substitute for one before mainnet deployment.

### Solidity Auditor: No material findings.
### Functional Auditor: No material findings.

### Static Analysis (Slither 0.11.6)

| Impact | Check | Finding | Disposition |
|---|---|---|---|
| Low | `timestamp` | `block.timestamp` used for expiry comparisons | **Accepted.** Unavoidable. Arc fast-finality makes miner manipulation negligible at 30-day scale. |
| Informational | `naming-convention` | `USDC` is all-caps | **Accepted.** Conventional style for an immutable. |

**Actionable Slither findings:** 0

---

## 5. Test Results (ACTUAL — run 2026-10-16)

**Test file:** `contracts/test/ArcReceiptCheckout.t.sol`
**Command:** `forge test --match-path contracts/test/ArcReceiptCheckout.t.sol -v`
**Total:** 41 tests passed, 0 failed, 0 skipped
**Re-run Day 3 (2026-10-16):** still 41/41, contract source unchanged.

```
[PASS] testFuzz_createRequest(uint256,uint256) (runs: 256, μ: 49266, ~: 11453)
[PASS] testFuzz_payAmountPreservation(uint256) (runs: 256, μ: 250395, ~: 250165)
[PASS] test_C01_EmitsRequestCreated() (gas: 136668)
[PASS] test_C01_StoredFieldsMatchInputs() (gas: 137484)
[PASS] test_C01_UniqueMonotonicIds() (gas: 377410)
[PASS] test_C02_AcceptsMaxWindowBoundary() (gas: 133811)
[PASS] test_C02_RevertExpiryExact() (gas: 11049)
[PASS] test_C02_RevertExpiryInPast() (gas: 11160)
[PASS] test_C02_RevertExpiryTooFar() (gas: 11278)
[PASS] test_C02_RevertZeroAmount() (gas: 11140)
[PASS] test_C03_PayHappyPath() (gas: 253449)
[PASS] test_C04_IndependentRequests() (gas: 398058)
[PASS] test_C05_DuplicatePayReverts() (gas: 290499)
[PASS] test_C06_CancelledRequestCannotBePaid() (gas: 240334)
[PASS] test_C06_ExpiredRequestCannotBePaid() (gas: 217462)
[PASS] test_C06_PayIdZeroReverts() (gas: 16092)
[PASS] test_C06_PayNonExistentIdReverts() (gas: 18130)
[PASS] test_C07_CancelIdZeroReverts() (gas: 11018)
[PASS] test_C07_CancelNonExistentReverts() (gas: 13088)
[PASS] test_C07_MerchantCanCancel() (gas: 162287)
[PASS] test_C07_NonMerchantCannotCancel() (gas: 137888)
[PASS] test_C08_PaidRequestCannotBeCancelled() (gas: 244126)
[PASS] test_C09_PartialAllowanceReverts() (gas: 261911)
[PASS] test_C09_ZeroAllowanceReverts() (gas: 240020)
[PASS] test_C09_ZeroBalanceReverts() (gas: 192198)
[PASS] test_C10_FailingTransferFromReverts() (gas: 1258964)
[PASS] test_C11_ReentrantTokenReverts() (gas: 1431865)
[PASS] test_C12_PayWithEtherReverts() (gas: 218434)
[PASS] test_C12_SelfPaymentReverts() (gas: 215169)
[PASS] test_C13_EmptyMerchantReturnsZero() (gas: 10919)
[PASS] test_C13_LimitCappedAt20() (gas: 2486674)
[PASS] test_C13_MultipleMerchantsIndependent() (gas: 359807)
[PASS] test_C13_OffsetPastEndReturnsEmpty() (gas: 2473399)
[PASS] test_C13_OrderingMatchesCreation() (gas: 530703)
[PASS] test_C13_SecondPage() (gas: 2477204)
[PASS] test_C14_LargeAmountStoredExactly() (gas: 136657)
[PASS] test_C14_SmallestAmount() (gas: 247177)
[PASS] test_Deploy_NextIdStartsAtOne() (gas: 133890)
[PASS] test_Deploy_USDCConstant() (gas: 5809)
Suite result: ok. 39 passed; 0 failed; 0 skipped; finished in 13.13s

Ran 2 tests for contracts/test/ArcReceiptCheckout.t.sol:ArcReceiptCheckoutInvariantTest
[PASS] invariant_noCustody() (runs: 256, calls: 128000, reverts: 0)
[PASS] invariant_requestIdMonotonic() (runs: 256, calls: 128000, reverts: 0)
Suite result: ok. 2 passed; 0 failed; 0 skipped; finished in 13.54s
```

### Mock Strategy
All mocks confined to `contracts/test/ArcReceiptCheckout.t.sol`. Production contract has no mock, backdoor, or test helper.

---

## 6. Deployment

### Arc Testnet

| Property | Value |
|---|---|
| Contract | `ArcReceiptCheckout` |
| Network | Arc Testnet (chainId 5042002) |
| Address | `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` |
| Deploy TX | `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45` |
| Explorer | https://explorer.testnet.arc.io/address/0x4017d948c7a8f370f5e8d0eee6da7be2859bea18 |
| Deployed at | 2026-10-16T07:21:04.299Z |
| Deploy block | NOT RECORDED — not returned by Mode 1 deploy tool |
| Source SHA-256 | `87b9c9a410ba3581358561f00ac25879d89b1f33501d03171dd6d6829d0f064b` |

### Deployed Bytecode Verification

Deployed bytecode vs compiled artifact: **NOT VERIFIED** — the Arc Testnet explorer does not expose a Blockscout source-verification API in the sandbox. The deployed contract can be read at the address above; the `USDC()` function returns `0x3600000000000000000000000000000000000000` as expected. Full bytecode comparison against the artifact would require forge's `--verify` flag with a supported explorer API key, which is not available in this environment.

### Post-Deploy Live Reads (2026-10-16, via read_contract)

```
USDC()                                               → 0x3600000000000000000000000000000000000000  ✓
getMerchantRequests(0xD995…4eD6, 0, 20)              → ([1,2,3,4,5,6], total=6)
getRequest(1)   merchant=0xD995…4eD6, amount=10000000, status=0 (Open), payer=0x000…
getRequest(2)   merchant=0xD995…4eD6, amount=10000000, status=0 (Open)
getRequest(3)   merchant=0xD995…4eD6, amount=10000000, status=0 (Open)
getRequest(4)   merchant=0xD995…4eD6, amount=100000000, status=0 (Open)  [100 USDC]
getRequest(5)   merchant=0xD995…4eD6, amount=10000000, status=0 (Open)
getRequest(6)   merchant=0xD995…4eD6, amount=10000000, status=0 (Open)
getRequest(7)   merchant=0x000…0, amount=0, status=0 → does not exist
```

**All 6 requests are Open. No payment has been made through the contract.**

### Revert Simulation (read-only eth_call, executed 2026-10-16)

```
pay(999) from 0x000…0001  → Execution reverted  (RequestNotFound — ID 999 does not exist)
pay(6)   from merchant M  → Execution reverted  (SelfPayment — payer == merchant)
pay(0)   from 0x000…0001  → Execution reverted  (RequestNotFound — ID 0 always invalid)
```

**Note on error decoding:** The Arc Testnet RPC returns `"Execution reverted for an unknown reason"` without the custom error selector bytes. The reverts are real — `eth_call` confirms the contract rejects each call — but the specific error names cannot be decoded from the RPC response alone. They are confirmed by the unit tests (C06, C12, C05) which decode the same errors in a local fork.

### Transaction Evidence

| Event | TX Hash | Status |
|---|---|---|
| Deploy | `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45` | Confirmed |
| createRequest (x6) | See merchant address on explorer | Confirmed (6 Open requests exist onchain) |
| pay(B) | **NOT RECORDED — payment not yet executed** | **NOT VERIFIED** |

---

## 7. Production Build (2026-10-16)

**Command:** `bunx vite build`
**Result:** ✓ built in 17.73s, 0 errors
**Warnings:** Large chunk warning for vendor libs (wagmi, viem, connectkit) — expected, not an error.
**Output:** `dist/` directory produced and verified.

---

## 8. Event Topic-0 Derivation (Day 3 fix)

Previous versions hardcoded topic-0 strings. These are now **derived from the ABI at module load time** in `src/lib/contract.ts`:

```ts
// keccak256 computed from ABI event signature at import time — never drifts from ABI
export const REQUEST_CREATED_TOPIC = eventTopic0('RequestCreated')
export const PAYMENT_RECORDED_TOPIC = eventTopic0('PaymentRecorded')
```

Verified values (bun keccak256, 2026-10-16):
- `REQUEST_CREATED_TOPIC`:  `0x41612386090d3716f01a2fa2e0e5b436c89d4479f1bd27e2644fe2ebad825cfe`
- `PAYMENT_RECORDED_TOPIC`: `0x3a2f85db325b07b9f114afef3024125aa494614d1bb7d56066da6dc83c9c637f`

**Previous bug (fixed):** The topic-0 was `0xb4c73acf…` (incorrect), causing `extractIdFromReceipt` to always return `null` and the A/B Demo to never advance past the first button.

---

## 9. Public Hosting

**Production build:** ✓ (see §7)
**Hugging Face deployment:** PENDING — HF account not yet connected. Connect via Integrations menu, then redeploy.
**Public URL:** NOT YET AVAILABLE
**VITE_APP_ORIGIN:** Set to public HF URL after deploy; QR codes and payment links will then encode the correct public origin.

---

## 10. Day 1 Requirements Checklist

| # | Requirement | Implementation | Test/Evidence | Status |
|---|---|---|---|---|
| R01 | Solidity compiler pinned | `foundry.toml` | forge test compiles | VERIFIED |
| R02 | OpenZeppelin SafeERC20 | `sol:4` | C03, C09, C10 PASS | VERIFIED |
| R03 | ReentrancyGuard on pay() | `sol:8,94` | C11 PASS | VERIFIED |
| R04 | Only canonical Arc USDC | immutable 0x3600…0000 | live USDC() read | VERIFIED |
| R05 | createRequest(amount, expiresAt) | `sol:59` | C01 C02 PASS | VERIFIED |
| R06 | Zero amount reverts | `sol:60` | C02 PASS | VERIFIED |
| R07 | Past/present expiry reverts | `sol:61` | C02 PASS | VERIFIED |
| R08 | Expiry > 30 days reverts | `sol:62` | C02 PASS | VERIFIED |
| R09 | Monotonically unique IDs from 1 | `sol:64` | C01 PASS | VERIFIED |
| R10 | Immutable payment terms | No update function | C01 reads PASS | VERIFIED |
| R11 | cancelRequest creator only | `sol:86` | C07 PASS | VERIFIED |
| R12 | cancelRequest Open only | `sol:87` | C08 PASS | VERIFIED |
| R13 | pay() nonReentrant, non-payable | `sol:94` | C11 C12 PASS | VERIFIED |
| R14 | Exact stored amount transferred | `sol:111` | C03 PASS | VERIFIED |
| R15 | Reject missing requests | `sol:95` | C06 PASS + eth_call CONFIRMED | VERIFIED |
| R16 | Reject cancelled requests | `sol:99` | C06 PASS | VERIFIED |
| R17 | Reject expired requests | `sol:100` | C06 PASS | VERIFIED |
| R18 | Reject already-paid | `sol:99` | C05 PASS | VERIFIED |
| R19 | Reject self-payment | `sol:101` | C12 PASS + eth_call CONFIRMED | VERIFIED |
| R20 | CEI order in pay() | `sol:107-113` | C10 C11 PASS | VERIFIED |
| R21 | Atomic rollback | CEI + Solidity atomicity | C10 PASS | VERIFIED |
| R22 | Store all fields | `sol:17` struct | C01 PASS | VERIFIED |
| R23 | Emit RequestCreated | `sol:78` | C01 PASS | VERIFIED |
| R24 | Emit RequestCancelled | `sol:91` | C07 PASS | VERIFIED |
| R25 | Emit PaymentRecorded | `sol:113` | C03 PASS | VERIFIED |
| R26 | getRequest(id) | `sol:116` | C01 C03 PASS | VERIFIED |
| R27 | getMerchantRequests paginated | `sol:120` | C13 PASS | VERIFIED |
| R28 | No custody balance | direct transfer | invariant_noCustody PASS | VERIFIED |
| R29 | No admin/upgrade/fee | contract has none | Slither 0 findings | VERIFIED |
| R30 | Fuzz tests | `testFuzz_*` | 256 runs PASS | VERIFIED |
| R31 | Invariant tests | `invariant_*` | 128k calls PASS | VERIFIED |
| R32 | Equal-amount A/B independence | C04 | PASS | VERIFIED |
| R33 | At most one settlement | C05 | PASS | VERIFIED |
| R34 | Payment never redirects | Merchant cached | Functional auditor: no findings | VERIFIED |
| R35 | Deploy to Arc Testnet | Mode 1 | TX confirmed | VERIFIED |
| R36 | createRequest onchain | User wallet | 6 Open requests exist onchain | VERIFIED |
| R37 | pay() from second wallet P | User connect wallet P, approve, pay | **NOT VERIFIED** |
| R38 | PaymentRecorded event verified | Read from pay() TX | **NOT VERIFIED** |
| R39 | B Paid, A Open after payment | Onchain state post-pay | **NOT VERIFIED** |
| R40 | Second pay(B) reverts | Duplicate rejection | eth_call reverts for nonexistent/merchant; Paid ID test awaits R37 |  **NOT VERIFIED** (requires Paid request) |
| R41 | Frontend: Dashboard, Checkout, Verify, A/B Demo | `src/components/` | Running on 5173 | VERIFIED |
| R42 | Correct IDs from receipts | ABI-derived topic-0 | Bug fixed 2026-10-16 | VERIFIED |
| R43 | No duplicate submit | Disabled buttons + separate hooks | Fixed 2026-10-16 | VERIFIED |
| R44 | Confirmed TX refreshes state | refetchInterval:4000 | Live reads | VERIFIED |
| R45 | Production build passes | `bunx vite build` | ✓ 0 errors, 17.73s | VERIFIED |
| R46 | Public hosting | HF Space | PENDING — connect HF account |  **NOT VERIFIED** |
| R47 | Payment links use public origin | `VITE_APP_ORIGIN` env var | Code ready, needs public URL | **NOT VERIFIED** |

---

## 11. Real Testnet Payment Flow (User Guide)

### Live Request State (read 2026-10-16)

| ID | Merchant | Amount | Status | Notes |
|---|---|---|---|---|
| 1 | 0xD995…4eD6 | 10 USDC | Open | Created in Day 1 |
| 2 | 0xD995…4eD6 | 10 USDC | Open | |
| 3 | 0xD995…4eD6 | 10 USDC | Open | |
| 4 | 0xD995…4eD6 | 100 USDC | Open | 100 USDC request |
| 5 | 0xD995…4eD6 | 10 USDC | Open | |
| 6 | 0xD995…4eD6 | 10 USDC | Open | **Use this as Request B** |
| 7+ | — | — | Does not exist | ID 7 returns zero address |

### Target for Demonstration
- **Merchant wallet M:** `0xD995d0c31802A8D95C163f875fFefB40AB964eD6`
- **Use Request #6 as B** (10 USDC, Open, created in latest session)
- **Use any other Open ID as A** (e.g. #5 or #1)

### Steps to complete R37–R40

1. **Get test USDC for wallet P** — click "Get test USDC" in the Arc Studio sidebar, connect wallet P (must differ from M).

2. **Open the Checkout tab** in the app, enter ID `6`. Confirm:
   - Merchant: `0xD995…4eD6`
   - Amount: `10.000000 USDC`
   - Status: Open

3. **Approve USDC** (Step 1 button):
   - Chain: Arc Testnet (5042002)
   - Contract: `0x3600000000000000000000000000000000000000` (canonical USDC ERC-20)
   - Function: `approve(address,uint256)`
   - Spender: `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`
   - Amount: `10000000` (exactly 10 USDC — not unlimited)
   - Record the approval TX hash.

4. **Pay** (Step 2 button):
   - Chain: Arc Testnet (5042002)
   - Contract: `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`
   - Function: `pay(uint256 id)`
   - id: `6`
   - Value: 0 (non-payable)
   - Record the payment TX hash.

5. **Verify on explorer:** Open the payment TX. Find the `PaymentRecorded` event:
   - topic-0: `0x3a2f85db325b07b9f114afef3024125aa494614d1bb7d56066da6dc83c9c637f`
   - topic-1 (id): 6
   - topic-2 (merchant): 0xD995…4eD6
   - topic-3 (payer): wallet P's address
   - data[0] (amount): 10000000
   - data[1] (paidAt): block timestamp

6. **Confirm A stays Open:** In the Verify tab, enter ID 5 (or 1). Should show Open.

7. **Duplicate-pay simulation:** After B is Paid, run eth_call on `pay(6)` — will revert. I'll record this immediately after payment.

8. **Fresh-browser receipt:** Open `<public-URL>?request=6&view=receipt` in an incognito window without connecting a wallet. Should show Paid state, payer address, and paidAt.

---

## 12. Wallet Simulation Warning — Decoded Actions

| Step | Chain | Contract | Function | Arguments | Intended Effect |
|---|---|---|---|---|---|
| Create Request | Arc Testnet (5042002) | `0x4017…be18` (ArcReceiptCheckout) | `createRequest(uint256,uint256)` | amount=10000000 (10 USDC), expiresAt=Unix+7days | Stores payment request; emits RequestCreated |
| Approve USDC | Arc Testnet (5042002) | `0x3600…0000` (USDC ERC-20) | `approve(address,uint256)` | spender=ArcReceiptCheckout, amount=10000000 | Grants exact-amount allowance only |
| Pay Request | Arc Testnet (5042002) | `0x4017…be18` (ArcReceiptCheckout) | `pay(uint256)` | id=6 | Transfers 10 USDC P→M; emits PaymentRecorded |

Reject any transaction that: requests unlimited approval (amount = `type(uint256).max`), sends native value > 0 to ArcReceiptCheckout, or targets any address other than the two above.

---

## 13. ABI (Key Signatures)

```json
[
  "function createRequest(uint256 amount, uint256 expiresAt) external returns (uint256 id)",
  "function cancelRequest(uint256 id) external",
  "function pay(uint256 id) external",
  "function getRequest(uint256 id) external view returns (tuple(address merchant, uint256 amount, uint256 expiresAt, uint8 status, address payer, uint256 paidAt))",
  "function getMerchantRequests(address merchant, uint256 offset, uint256 limit) external view returns (uint256[] ids, uint256 total)",
  "function USDC() external view returns (address)",
  "event RequestCreated(uint256 indexed id, address indexed merchant, uint256 amount, uint256 expiresAt)",
  "event RequestCancelled(uint256 indexed id, address indexed merchant)",
  "event PaymentRecorded(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 paidAt)"
]
```

Full ABI: `contracts/out/ArcReceiptCheckout.sol/ArcReceiptCheckout.json`

---

## 14. Mainnet Deployment (User-Operated — DO NOT run without independent audit)

No seed phrase or private key was requested at any point. Steps once ready:

```bash
# 1. Export project (Code panel → Download)
# 2. Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup
# 3. Build
cd /path/to/project && forge build
# 4. Deploy (use --ledger or --trezor instead of --private-key for hardware wallets)
forge create contracts/ArcReceiptCheckout.sol:ArcReceiptCheckout \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $YOUR_PRIVATE_KEY
# 5. Verify: USDC() must return 0x3600000000000000000000000000000000000000
# 6. Set VITE_APP_ORIGIN and CONTRACT_ADDRESS in frontend .env then rebuild
```

**Preconditions before mainnet:**
- [ ] At least one successful testnet payment (R37–R40)
- [ ] Public testnet frontend tested with real wallet
- [ ] Independent third-party audit (NOT fulfilled by this internal review)
- [ ] Do not proceed to mainnet until all testnet checks pass

---

## 15. Completed / Pending / Not Verified

### Completed
- [x] Chain config verified from canonical registry
- [x] USDC ERC-20 / native decimal distinction documented
- [x] Contract: SafeERC20, ReentrancyGuard, CEI, no custody, no admin
- [x] 41/41 tests passing (actual forge output, repeated in Day 3)
- [x] Security review: no material findings
- [x] Slither: 0 actionable findings
- [x] Deployed to Arc Testnet: `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18`
- [x] Live USDC() read: `0x3600000000000000000000000000000000000000`
- [x] 6 Open requests confirmed onchain
- [x] Production build: ✓ 0 errors
- [x] Event topics derived from ABI (not hand-copied) — Day 3 fix
- [x] Wrong topic-0 bug fixed (was `0xb4c73acf…`, now `0x41612386…`)
- [x] `buildPaymentLink` uses `VITE_APP_ORIGIN` env var for public URLs
- [x] Fixed `PublicReceipt` explorer link
- [x] Frontend: Dashboard, Checkout, Verify, A/B Demo
- [x] Error handling: wallet rejection, wrong network, insufficient funds, expired, duplicate pay disabled

### Pending (requires HF account connection)
- [ ] Connect HF account → Deploy public static Space → Set `VITE_APP_ORIGIN`

### Not Verified (requires wallet action)
- [ ] R37: pay() from wallet P
- [ ] R38: PaymentRecorded event from TX
- [ ] R39: B Paid, A Open after payment + reload
- [ ] R40: Duplicate pay(B) revert on Paid request (eth_call simulation ready to run post-payment)
- [ ] R46/R47: Public hosting + QR links encoding public URL

---

## 16. Security Limitations

1. **Block timestamp:** Validators can shift `block.timestamp` by a few seconds. Immaterial at 30-day scale.
2. **No on-chain exchange rate:** Amounts are raw 6-decimal USDC units; human-readable display is off-chain.
3. **No refund mechanism:** Paying the wrong ID sends funds to the wrong merchant. The UI shows a request preview before approve.
4. **Internal review only:** Zero findings from Studio tooling. NOT a substitute for a paid third-party audit before mainnet.
5. **Immutable USDC address:** If Circle redeploys USDC on Arc, the contract must be redeployed.
6. **Unsolicited deposits:** ERC-20 `transfer()` to the contract address creates unrecoverable funds. Only affects attackers sending themselves; does not affect payers.
7. **RPC error decoding:** Arc Testnet RPC does not return custom error selector bytes; specific revert reasons confirmed only via unit tests and local fork, not from live eth_call responses.

---

## 17. Wallet Bug Diagnosis and Fix (2026-10-16)

**Observed symptoms (from user video):**
- Rabby shows loading skeleton indefinitely after createRequest click.
- Rabby toast: "Detected multiple requests from this Dapp."
- Cancellation produces "User rejected the request."
- Error text includes "chain: undefined (id: 5042002)."
- No successful payment demonstrated.

**Root cause analysis:**

| Issue | Root cause | Fix applied |
|---|---|---|
| "Multiple requests" / skeleton freeze | `PublicCheckout` called `useWriteContract()` twice (doApprove + doPay). Both hooks fire `eth_estimateGas` + `eth_chainId` on mount, flooding Rabby's EIP-1193 queue simultaneously. | Merged to **one** `useWriteContract` hook with `phase` state ('approve'/'pay'). Only one wallet interaction is ever active at a time. |
| "chain: undefined (id: 5042002)" | `config.ts` used `http()` with no URL; wagmi fell back to blank transport. Rabby does not have Arc Testnet (5042002) in its built-in chain list, so simulation showed "undefined". | Added explicit `http('https://rpc.testnet.arc.io', { timeout: 30_000 })` transport; Rabby receives correct `wallet_addEthereumChain` params. |
| N simultaneous cancel hooks | Every `RequestRow` mounted its own `useWriteContract`. N rows = N simultaneous hook instances, each registering with wagmi's provider connection. | Moved cancel to a **single shared hook** in `MerchantDashboard` parent, passed down as `onCancel` callback. Rows are now read-only. |
| No duplicate-click guard | No `busy` check before calling `writeContract`. User or React could dispatch two requests before the first wallet prompt appeared. | Added `if (busy) return` hard guard at the top of every handler before any wallet call. |
| Raw error messages | Rejection showed raw ABI calldata (e.g. "ContractFunctionExecutionError: ..."). | `decodeError()` function maps known patterns to human messages; "You rejected the request in your wallet." replaces raw args. |

**Bytecode verification (this session):**
- Deploy TX: `0xa464d3b5594a471071744763ec765283a579ffae44c890fe7b2eef5c4e8f0f45`
- Deployment block: **67,462,931** (confirmed from TX receipt)
- Deployed bytecode length: 2820 bytes
- Compiled artifact length: 2820 bytes
- Comparison method: mask immutable slots (slot 89 at byte offsets 296 and 1648), compare remaining bytes
- Result: **MATCH** — deployed bytecode equals compiled artifact after immutable masking
- Immutable baked value at both slots: `0x0000000000000000000000003600000000000000000000000000000000000000` (Arc canonical USDC)

**eth_call simulations run (evidence of revert behavior):**
- `pay(999)` from `0x000...001` → reverts (RPC returns execution revert; custom error bytes not returned by Arc Testnet RPC)
- `pay(0)` from `0x000...001` → reverts
- `pay(6)` from merchant `0xD995…4eD6` → reverts (self-payment guard)
- All three reverts confirmed. Specific error names confirmed via forge unit tests (C06, C07, C12), not from RPC response.

**Current onchain state (read 2026-10-16):**
- IDs 1–6: all status Open, merchant `0xD995…4eD6`, amounts 10–100 USDC
- No request has ever been paid through the contract.
- R37–R40 remain NOT VERIFIED.
