# ArcReceipt — Pending Work and Known Issues

> Open items only. Completed tests and resolved fixes are in COMPLETED.md.
> Updated: 2026-10-28

---

## CRITICAL — Must resolve before mainnet/production

### C2: No independent security audit

The contract at `0x4017d948c7a8f370f5e8d0eee6da7be2859bea18` has passed all internal tests but has not been reviewed by an external auditor. **Do not deploy to mainnet or use with real funds without an independent audit.**

Known safe properties (not a substitute for audit):
- No custody: USDC goes direct customer → merchant, contract balance stays zero.
- No owner or admin: nobody can pause, freeze or modify after deployment.
- No upgradeability: code is permanently fixed.
- ReentrancyGuard on `pay()`.
- SafeERC20 `safeTransferFrom`.
- SelfPayment revert.

Recommended path: Cyfrin, 0xMacro, or run Slither + Aderyn and publish reports as minimum due diligence. See `DEPLOYMENT-GUIDE.md`.

---

## MAINNET CHECKLIST (do not deploy until all checked)

- [ ] C2: Independent Solidity audit completed and findings resolved
- [ ] Run Slither + Aderyn, publish automated reports in repo
- [ ] Verify Arc Mainnet USDC address against official Circle docs
- [ ] Deploy new contract to Arc Mainnet (testnet contract is testnet-only)
- [ ] Update `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK` in frontend source
- [ ] Update `VITE_APP_ORIGIN` in Vercel to mainnet domain
- [ ] Update `VITE_MERCHANT_ADDRESS` to mainnet merchant wallet(s)
- [ ] Rebuild and redeploy frontend
- [ ] Test one real USDC payment end-to-end before publishing link
- [ ] See `DEPLOYMENT-GUIDE.md` for full step-by-step
