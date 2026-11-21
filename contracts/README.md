# Kosha contracts

The on-chain layer of **Kosha**, a community treasury for a cluster of Odisha MSMEs. Twenty small businesses pool their idle working capital into one ERC-4626 vault. The vault keeps a liquid buffer, earns on tokenised government securities, and lends to members against verified invoices. No single person, committee or AI can move money alone: allocations need two of three committee signatures and a 24-hour timelock, and the caps are constants the contract enforces whatever anyone signs.

> **Local demo and testnet only.** The e-Rupee, the ARC stablecoin and the T-bills are mocks with no value. The code is not audited. Do not deploy it to mainnet or use it with real funds.

**Status:** 8 contracts, **74 tests passing**, 100% line, statement and function coverage, 84% branch coverage.

Built with Solidity 0.8.24 (optimizer on, 200 runs, `cancun`), Hardhat 2 and OpenZeppelin Contracts 5 (`ERC4626`, `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `TimelockController`).

## Quick start

```bash
npm install
npm test                 # 74 tests
npm run coverage         # coverage table + HTML report in coverage/index.html

npm run node             # terminal 1: local chain (keep it running)
npm run deploy:local     # terminal 2: deploy all 8 contracts
npm run seed:local       # 20 members deposit Rs 1.2 crore through the gateway
```

If your network blocks the Solidity compiler download (binaries.soliditylang.org), put `SOLC_FROM_NPM=1` in front of any command. Hardhat then compiles with the bundled `solc` npm package.

The local chain always starts on **20 November 2026, 09:00 IST** (`initialDate` in `hardhat.config.js`), so the dates in the dummy invoices line up with the story whenever you run it. Override with `KOSHA_CHAIN_DATE`.

| Script | Does |
| --- | --- |
| `npm run compile` | Compile the contracts |
| `npm test` | Run all 74 tests |
| `npm run coverage` | Tests with line and branch coverage |
| `npm run node` | Local Hardhat chain on :8545 with 30 funded accounts |
| `npm run deploy:local` / `deploy:sepolia` | Deploy and wire every contract, write `deployments/<network>.json` |
| `npm run seed:local` / `seed:sepolia` | Mint mock e-Rupee, run every member deposit through the gateway, fund the coupon issuer, set the T-bill APR |

## The contracts

| Contract | Role in Kosha | Who can do what |
| --- | --- | --- |
| `MockERupee` (eINR) | Stand-in for the RBI e-Rupee, the way money enters and leaves | The deployer acts as a mock RBI and mints wallet balances |
| `MockARC` (mARC) | Stand-in rupee stablecoin, the vault's unit of account | Only `PartnerGateway` mints and burns |
| `KycRegistry` | Allow-list of wallets the licensed partner has verified | The partner sets and revokes; every change emits `KycSet` |
| `PartnerGateway` | The NBFC partner's bridge: eINR in, mARC inside, eINR out | Members request deposits; the partner settles or rejects; members cancel after 3 days; verified wallets `cashIn`; anyone `cashOut` |
| `KoshaVault` (kSHARE) | ERC-4626 vault with three pockets, a loan book and async redemption | The timelock allocates; the partner lends and writes off; the keeper pulls G-sec money back; anyone repays and fulfils; pausers pause; only the timelock unpauses |
| `MockGsecStrategy` | Stand-in for tokenised 91-day T-bills | Vault-only deposit and T+1 withdrawal; the issuer pays coupons and sets the APR (max 20%) |
| `CommitteeMultisig` | The 2-of-3 risk committee | Two confirmations schedule an operation on the timelock; any one member can veto; each proposal records the AI `proposalHash` |
| `KoshaTimelock` | OpenZeppelin `TimelockController` | Self-administered after deploy; 24 h delay (10 min on Sepolia); anyone can execute a ready operation |

Supporting files: `interfaces/IKycRegistry.sol`, `interfaces/IGsecStrategy.sol`, `scripts/lib/deployKosha.js` (the single wiring function used by both the deploy script and every test, so tests exercise the exact production wiring).

## Features

### Three pockets with hard caps

`totalAssets()` is the sum of three pockets:

1. **Liquid buffer:** idle mARC in the vault, excluding money already promised to redeeming members.
2. **G-secs:** the value held by `MockGsecStrategy`, including withdrawals still settling.
3. **Invoice loans:** principal of active loans.

The caps are `constant` values. No role, vote or upgrade can change them, and the vault is not upgradeable:

| Cap | Value | Checked when |
| --- | --- | --- |
| `BUFFER_MIN_BPS` | 15% minimum | Every allocation to G-secs and every new loan |
| `GSEC_MAX_BPS` | 50% maximum | Every allocation to G-secs |
| `INVOICE_MAX_BPS` | 35% maximum | Every new loan |
| `MEMBER_MAX_BPS` | 5% per member, summed across all their loans | Every new loan |

The caps are checked inside the function that moves the money, after the move. They stop new moves. They do not force a sale if large redemptions push a pocket over its cap; the contract simply blocks further moves in that direction.

### KYC-gated shares that never trap anyone

Vault shares (`kSHARE`) can only move between KYC-verified wallets, including through `approve` and `transferFrom`. Minting, burning and moving shares into or out of the vault itself (redemption locks) are exempt, so a member whose KYC lapses can still redeem, request a redemption, cancel it and cash out. Deposits need both the caller and the receiver to be verified. Withdrawing to someone else needs a verified receiver.

### Deposits through a licensed partner

1. The member locks eINR with `requestDeposit(amount, clientKey)`. The `clientKey` is an idempotency key, scoped per member, so a retried app call cannot deposit twice.
2. The partner calls `settleDeposit(id)`: the gateway mints mARC 1:1 and deposits it into the vault for the member. Each request settles exactly once.
3. Or the partner calls `rejectDeposit(id)` and the eINR goes back.
4. If the partner does nothing for 3 days, the member calls `cancelDeposit(id)` and gets the eINR back.

The gateway keeps one invariant at all times: **eINR held = mARC supply + pending deposits.** Yield never mints new tokens; it arrives as coupons the issuer pays in.

### Governance: two signatures and 24 hours

Only the timelock holds `ALLOCATOR_ROLE` and every admin role. The deployer renounces everything after wiring. To move buffer money into G-secs:

1. A committee member calls `submit(target, value, data, salt, proposalHash)`, which also counts as their confirmation. `proposalHash` is the SHA-256 of the AI proposal and its data snapshot, so the signed proposal can be checked against the stored file.
2. A second member calls `confirm(id)`. Two confirmations schedule the call on the timelock.
3. During the 24 hours, any one member can `cancel(id)`. Stopping money is the safe direction, so a single veto is enough.
4. After the delay, anyone can `execute` it. The keeper usually does, but a dead keeper cannot block anything.

Changing the delay itself, replacing a lost committee key (`replaceOwner`) and unpausing the vault all go through the same 2-of-3 + timelock path.

### Member invoice loans

The partner opens a loan with `openLoan(borrower, principal, rateBps, dueDate, invoiceHash)` after checking the invoice off-chain. The contract then enforces the rules:

- The borrower must be KYC-verified and hold vault shares.
- Each `invoiceHash` can back one loan only, and the zero hash is refused.
- The tenor is at most 180 days and the rate at most 30% a year.
- The member cap (5%), the pool cap (35%) and the buffer floor (15%) must all hold after the loan.

Interest is simple interest on elapsed time. Anyone can `repayLoan(id)`, including the exporter paying on the member's behalf, and repayment works while paused. Interest raises the share price for every member. Thirty days after the due date, the partner can `writeOffLoan(id)`: the loss is shared through a lower share price, the member's exposure stays counted until the loan is recovered, and a later repayment restores the pool.

### Redemptions: instant or queued (ERC-7540 style)

- **Instant:** `redeem` and `withdraw` pay from the buffer. `maxRedeem` and `maxWithdraw` are capped by idle liquidity, never by pause or KYC status.
- **Queued:** when the buffer cannot pay today, the member calls `requestRedeem(shares)` and the shares are locked in the vault. `fulfilRedeem(id)` prices the request at that moment's share price and sets the money aside; anyone can call it. Only the owner can `claimRedeem(id)` (once) or `cancelRedeem(id)` before fulfilment.
- Money reserved for fulfilled requests is excluded from `totalAssets()` and can be neither lent nor allocated.
- The keeper (or the timelock) can pull money back from G-secs with `requestFromGsec`. It settles T+1, and anyone can finish it with `claimFromGsec`.

This follows ERC-7540's request, fulfil and claim pattern but does not implement its full interface.

### Pause that never traps money

`pause()` (committee members and the reconciler hold `PAUSER_ROLE`) stops new deposits, new allocations and new loans. It never stops instant redemptions, redemption requests, fulfilment, claims, repayments or cash-outs. Pausers cannot unpause; only the timelock can, so an automated monitor can stop money moving but never restart it on its own.

### Protection against known vault attacks

- **First-depositor inflation attack:** the vault uses OpenZeppelin's virtual-share offset (`_decimalsOffset() = 3`). In test X-01 an attacker who deposits 1 wei and donates Rs 10 lakh loses money, and the next depositor loses less than 0.1%.
- **Reentrancy:** every state-changing entry point is `nonReentrant`, and every token transfer uses `SafeERC20`.
- **Strategy hijack:** `setVault` can be called once, and the strategy's deposit, withdraw and claim functions are vault-only. The vault constructor refuses a strategy that holds a different asset.

## Roles after deployment

| Hardhat account | Who | On-chain roles |
| --- | --- | --- |
| #0 | Deployer and mock RBI | Mints eINR only; renounces every admin role |
| #1 | NBFC partner | `KYC_ADMIN_ROLE`, gateway `PARTNER_ROLE`, vault `PARTNER_ROLE` |
| #2 | Keeper | Vault `KEEPER_ROLE` |
| #3, #4, #5 | Committee: Prakash Mohanty, Sasmita Das, Rakesh Behera | Multisig owners, `PAUSER_ROLE` |
| #6 to #25 | The 20 members (#6 is Meera) | KYC-verified |
| #26 | Unverified outsider | None (negative tests) |
| #27 | Attacker | None (negative tests) |
| #28 | Reconciler monitor | `PAUSER_ROLE` only |
| #29 | Mock RWA issuer | Strategy `ISSUER_ROLE`, KYC-verified |
| `KoshaTimelock` | | `DEFAULT_ADMIN_ROLE` on every contract, vault `ALLOCATOR_ROLE`, its own admin |
| `CommitteeMultisig` | | Timelock `PROPOSER_ROLE` and `CANCELLER_ROLE` |

Hardhat's default mnemonic is public. These keys are worthless outside the local chain and must never hold real funds.

## Deploying to Sepolia

1. Copy `.env.example` to `.env` and fill in `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`, `TIMELOCK_DELAY=600` and the role addresses: `PARTNER_ADDRESS`, `KEEPER_ADDRESS`, `COMMITTEE_ADDRESSES` (three, comma-separated), `RECONCILER_ADDRESS`, `ISSUER_ADDRESS`.
2. `npm run deploy:sepolia`. Addresses and the deploy block go to `deployments/sepolia.json`. Test D-09 covers this address-based wiring.
3. Seed with `PARTNER_PRIVATE_KEY=... ISSUER_PRIVATE_KEY=... MEMBER_PRIVATE_KEYS=k1,k2,... SEED_MEMBERS=5 npm run seed:sepolia`.
4. Verify each contract with `npx hardhat verify --network sepolia <address> <constructor args>`.

Use fresh wallets funded from a Sepolia faucet. Never put a key that holds real funds in `.env`.

## Test coverage

| File | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| All contracts | 100 | 84 | 100 | 100 |

Run `npm run coverage` for the per-file table and `coverage/index.html` for a line-by-line view. The uncovered branches are mostly defensive checks the rest of the contract never lets happen, such as reserved money exceeding the vault balance in `idleAssets()`.

Tests share one wiring function, `scripts/lib/deployKosha.js`, and two fixtures in `test/helpers.js`: a fresh deployment, and a seeded pool of 20 members x Rs 5,00,000 (Rs 1 crore), where the caps are round numbers (5% = Rs 5 lakh, 15% = Rs 15 lakh, 35% = Rs 35 lakh, 50% = Rs 50 lakh). Every test ID below is also listed in `backend/test/TEST_PLAN.json`, where a traceability test fails the build if any ID loses its test.

### Deployment and roles (`01.deployment.test.js`, 9 tests)

| ID | What it proves |
| --- | --- |
| D-01 | Deployer keeps no admin role; the timelock administers everything, itself included |
| D-02 | Only the gateway can mint mARC |
| D-03 | Caps are compile-time constants |
| D-04 | Timelock delay is 24 h and only the multisig can propose |
| D-05 | Only the timelock holds ALLOCATOR_ROLE and the strategy's vault is fixed |
| D-06 | Multisig rejects duplicate or zero owners |
| D-07 | Vault refuses a strategy with a different asset |
| D-08 | Empty vault reports zero allocation without dividing by zero |
| D-09 | Public-network mode wires roles from plain addresses (Sepolia path) |

### PartnerGateway (`02.gateway.test.js`, 10 tests)

| ID | What it proves |
| --- | --- |
| G-01 | An unverified wallet cannot request a deposit |
| G-02 | Settlement mints mARC 1:1 and gives the member vault shares |
| G-03 | A request settles exactly once |
| G-04 | A reused idempotency key is refused per member, not across members |
| G-05 | Only the partner settles or rejects |
| G-06 | A rejected deposit refunds the e-Rupee |
| G-07 | If the partner goes silent, the member can cancel after 3 days |
| G-08 | Cash-in needs KYC; cash-out never does, so a revoked member can always exit |
| G-09 | Zero amounts are refused |
| G-10 | Reserve invariant holds across a mixed flow: eINR held = mARC supply + pending |

### KYC-gated shares (`03.vault-kyc.test.js`, 6 tests)

| ID | What it proves |
| --- | --- |
| K-01 | Shares cannot move to an unverified wallet |
| K-02 | Shares move freely between verified members |
| K-03 | A verified member can deposit directly; an outsider holding mARC cannot |
| K-04 | A member whose KYC lapses cannot transfer, but can still redeem and request redemption |
| K-05 | Withdrawing to someone else requires a verified receiver |
| K-06 | Zero-asset deposits are refused |

### Allocation, committee and timelock (`04.allocation-governance.test.js`, 17 tests)

| ID | What it proves |
| --- | --- |
| A-01 | Nobody but the timelock can allocate (members, partner, keeper, a single committee member) |
| A-02 | 2-of-3 + 24 h moves 30% into G-secs |
| A-03 | G-sec cap: exactly 50% passes, one wei more fails |
| A-04 | Buffer floor: an allocation leaving under 15% fails even with G-secs under 50%; exactly 15% passes |
| A-05 | Even all three committee members cannot break a cap |
| V-01 | One signature schedules nothing |
| V-02 | Execution before 24 h fails; at 24 h it succeeds |
| V-03 | Any single member can veto during the timelock |
| V-04 | Outsiders cannot submit; owners cannot double-confirm; a revoked vote does not count |
| V-05 | Anyone can execute a ready operation, so a dead keeper cannot block it |
| V-06 | The delay itself can only change through the timelock |
| V-07 | A lost committee key is replaced only through governance |
| V-08 | The AI proposal hash is recorded on-chain with the proposal |
| A-06 | Pausing blocks allocations even after approval |
| A-07 | G-sec money comes back to the buffer only after T+1, and only by allocator or keeper |
| A-08 | Strategy entry points are vault-only |
| A-09 | Coupons raise the share price for every member |

### Member invoice loans (`05.loans.test.js`, 11 tests)

| ID | What it proves |
| --- | --- |
| L-01 | The partner lends against a verified invoice; the member receives mARC |
| L-02 | Nobody else can open a loan |
| L-03 | Per-member cap: exactly 5% passes, one wei more fails, across several invoices |
| L-04 | Pool cap: 35% across members passes, one wei more fails |
| L-05 | An invoice can back only one loan; the zero hash is refused |
| L-06 | Borrowers must be verified members of the pool |
| L-07 | Due date must be in (now, now + 180 days]; rate at most 30% |
| L-08 | Repayment with interest raises the share price and clears exposure; the exporter can pay directly |
| L-09 | Write-off only after due + 30 days; loss is shared; exposure stays until recovered |
| L-10 | Loans respect the buffer floor when redemptions have drained the buffer |
| L-11 | Pause stops new loans but never stops repayment |

### Redemptions and pause (`06.redemption-pause.test.js`, 8 tests)

| ID | What it proves |
| --- | --- |
| R-01 | An instant redemption pays exactly the previewed amount |
| R-02 | Instant redemptions are limited to the buffer; beyond it the request path is used |
| R-03 | A request locks shares; only its owner can cancel it |
| R-04 | Full async path: no liquidity, keeper pulls G-secs T+1, anyone fulfils, only the owner claims, once |
| R-05 | The price is fixed at fulfilment, and reserved money is outside TVL and cannot be lent |
| R-06 | Pause blocks new deposits and settlement; the partner refunds the stuck request |
| R-07 | Pause never traps money: instant redeem, request, fulfil and claim all work while paused |
| R-08 | Pausers can pause but not unpause; only the timelock unpauses |

### Attacks and invariants (`07.attacks-invariants.test.js`, 4 tests)

| ID | What it proves |
| --- | --- |
| X-01 | First-depositor inflation attack does not steal from the next depositor |
| X-02 | An outside attacker is refused by every privileged function |
| X-03 | A share transfer cannot be used to sneak shares to an outsider via approve + transferFrom |
| X-04 | Randomised run of 300 actions keeps every accounting invariant |

### Edge cases and input validation (`08.edge-cases.test.js`, 9 tests)

| ID | What it proves |
| --- | --- |
| E-01 | ERC-4626 mint path is gated exactly like deposit |
| E-02 | Constructors reject zero addresses |
| E-03 | Strategy refuses zero amounts and a zero vault |
| E-04 | Allocation larger than idle money is refused with the available amount |
| E-05 | Multisig edge paths: revoke without vote, unknown cancel, cancel after execution, bad owner swap |
| E-06 | Loan views and status checks on unknown loans |
| E-07 | Redemption requests: zero shares, unknown ids, more shares than held |
| E-08 | KYC batch revoke and re-verify are logged as events |
| E-09 | A second G-sec request restarts the T+1 clock for the whole pending amount |

## Gap review

Every gap below was found by reviewing the design against the three Kosha articles, closed in code, and pinned by a test.

| Gap | How the contract closes it | Test |
| --- | --- | --- |
| Deployer keeps admin keys after launch | Every admin role moves to the timelock; the deployer renounces | D-01 |
| One person moves money | Only the timelock holds `ALLOCATOR_ROLE`; only the 2-of-3 multisig can schedule | A-01, V-01 |
| The whole committee agrees to break a cap | Caps are constants checked in the function; execution reverts | A-03, A-05 |
| Money moves before members can look | 24 h timelock | V-02 |
| A bad proposal is approved anyway | Any single member can cancel during the delay | V-03 |
| Someone quietly shortens the delay | `updateDelay` only through the timelock | V-06 |
| A committee key is lost | `replaceOwner` only through governance | V-07 |
| Keeper or backend is down | Open timelock executor; permissionless `fulfilRedeem` and `claimFromGsec` | V-05, R-04, A-07 |
| Pause traps members' money | Pause covers deposits, allocations and new loans only | R-07, L-11 |
| The automated reconciler abuses its pause right | `PAUSER_ROLE` cannot unpause | R-08 |
| Shares reach an unverified wallet | `_update` checks both sides of every transfer | K-01, X-03 |
| A member whose KYC lapses is trapped | Exit paths stay open | K-04, G-08 |
| Unbacked ARC is minted | Only the gateway mints, 1:1; yield arrives as paid coupons | D-02, G-10, X-04 |
| A retried app call deposits twice | One-shot status machine + per-member `clientKey` | G-03, G-04 |
| The partner sits on a member's eINR | Member cancels after 3 days | G-07 |
| One invoice is financed twice | `invoiceUsed` mapping; zero hash refused | L-05 |
| Lending concentrates on one member | 5% exposure cap across all their loans | L-03 |
| Lending crowds out everything else | 35% pool cap | L-04 |
| Loans to outsiders or to the partner itself | Borrower must be verified and hold shares | L-06 |
| Absurd loan terms | Tenor at most 180 days, rate at most 30% | L-07 |
| Bad debt inflates the share price forever | Write-off after due + 30 days | L-09 |
| Lending or allocation drains the buffer | 15% floor on every active move | A-04, L-10 |
| Money owed to a redeeming member is lent out | `idleAssets()` excludes `reservedForClaims` | R-05 |
| Redemption price games | Price fixed at fulfilment | R-04, R-05 |
| First-depositor inflation attack | Virtual-share offset | X-01 |
| Strategy swapped or called directly | One-time `setVault`; vault-only entry points | D-05, A-08 |
| Strategy holding the wrong asset | Constructor check | D-07 |
| Reentrancy | `nonReentrant` + `SafeERC20` throughout | all |
| Accounting drifts over time | 300-step randomised run checks the invariants after every step | X-04 |

## Accepted limits

- **The partner is trusted.** It controls KYC and opens loans, so a corrupt partner could still lend up to 5% to a colluding member against a fake invoice. The contract bounds the damage and every loan is public, but production would add a second signer on partner actions.
- **Caps stop moves, not drift.** Large redemptions can leave G-secs or loans above their caps; the agent is expected to propose the rebalance.
- **One T+1 clock.** A second G-sec withdrawal request restarts the clock for the whole pending amount (E-09).
- **Simple interest, no late fee.**
- **ERC-7540 pattern, not the full interface.**
- **Not audited.** Run `pipx install slither-analyzer && slither .` before any public deployment, and treat its findings as fixes.

## Folder layout

```
contracts/
  KoshaVault.sol  PartnerGateway.sol  KycRegistry.sol
  tokens/MockERupee.sol  tokens/MockARC.sol
  strategies/MockGsecStrategy.sol
  governance/CommitteeMultisig.sol  governance/KoshaTimelock.sol
  interfaces/IKycRegistry.sol  interfaces/IGsecStrategy.sol
scripts/
  lib/deployKosha.js   deploy.js   seed.js
test/
  helpers.js  01..08 *.test.js
hardhat.config.js  .env.example
```

The dummy data the seed script reads (members, exporters, invoices, T-bill yields, redemption history, policy) lives in `../data`.