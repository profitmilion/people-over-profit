# POP33 Demo V1

## Document status

This document defines the scope and records the first controlled POP33 Demo V1
deployment and its separate frontend integration. The contracts and local
frontend integration are complete; this record does not authorize any
additional public-chain transaction or a public frontend release.

Approved product behavior remains governed by `BUSINESS_RULES.md` and
`BASIC_V1_SPEC.md`. Open product decisions remain `TO DECIDE` and are collected
in `BUSINESS_RULES.md` rather than resolved here.

## Purpose and environment

POP33 Demo V1 is deployed on Base Sepolia, chain ID `84532`. It is a technical
testnet demonstration only:

- it uses POP33 Demo USD (`dUSDC`), a POP33-owned test token with no monetary
  value;
- it is not a production product or a service offering real prizes;
- it does not accept real payments and provides no economic guarantees;
- its current winner-selection mechanism is temporary, manipulable, and not
  production-safe;
- it has no KYC, proof-of-personhood, or multi-account protection;
- it does not establish a legal or production operating model.

The Demo V1 token type is decided: `Pop33DemoUSDC`, with name `POP33 Demo USD`,
symbol `dUSDC`, and six decimals. It is not issued by or affiliated with Circle,
is not official Circle test USDC, and is not the intended future mainnet USDC
payment asset. Its deployed Base Sepolia address is recorded below. The
unrestricted `MockUSDC` remains a local test fixture and is not part of either
public deployment path.

## Demo V1 technical configuration

All token amounts are stored in the smallest six-decimal token units.

| Parameter | Demo V1 value |
| --- | ---: |
| Positions per pool | 100 |
| Position price | 33,000,000 units (33 dUSDC) |
| Full pool | 3,300,000,000 units (3,300 dUSDC) |
| Draw rounds | 10 |
| Prize per round | 330,000,000 units (330 dUSDC) |
| Different winning positions | 10 |
| Base Sepolia draw interval | 3,600 seconds |
| Faucet drip | 330,000,000 units (330 dUSDC) |
| Faucet cooldown | 86,400 seconds (24 hours) per address |

The winning position is removed only from the remaining candidate set of its
own pool. Positions in other pools are unaffected. The contract enforces one
active position per wallet in one pool, but it does not know whether multiple
wallets belong to one person; identity-level limits remain `TO DECIDE`.

Each finalized round credits a pull-based prize. The winning wallet may call
`claim(poolId, roundNumber)` while the pool is still `Drawing`. Under the
current narrow settlement rule, the pool reaches `Finished` only after all ten
prizes have been claimed.

## Intended end-to-end demonstration

The separate `#/demo-v1` frontend supports:

1. connecting a wallet on Base Sepolia;
2. seeing the connected network, native gas balance, dUSDC balance, and next
   faucet availability;
3. using a clearly labelled `Pobierz środki testowe` action that calls `drip()`;
4. approving and paying dUSDC for a position;
5. filling a pool with 100 positions;
6. observing the transition to `Locked`;
7. executing ten scheduled rounds;
8. displaying the ten winning positions and wallets;
9. claiming all ten credited prizes;
10. observing the transition to `Finished`;
11. displaying the completed pool and round history in an on-chain archive.

The `#/archive-v1` route reads pools and all ten round records per pool from
contract getters. It does not replace the legacy `#/demo` or browser-local
`#/archive` routes.

## Deployment tooling

### Durable operator recovery foundation

The local operator now has a versioned encrypted wallet provider and a separate
versioned transaction journal. The wallet file uses scrypt key derivation and
AES-256-GCM authenticated encryption with random salt and IV values. Wallet
addresses and private keys are encrypted; wrong passwords and modified or
truncated files are rejected. The file path is read from
`OPERATOR_WALLET_STORE_PATH`, must remain outside the repository, and is written
atomically with restrictive permissions where the operating system supports
them. The local durable opener reads the password at runtime through an
interactive reader. The public read-only inspector accepts it only from the
transient `OPERATOR_WALLET_STORE_PASSWORD` process environment and never writes
or logs it; it must not be placed in a repository `.env` file.

The non-secret journal path is read from
`OPERATOR_TRANSACTION_JOURNAL_PATH`. Every semantic operation receives a stable
idempotency key. Intent and nonce are persisted before broadcast, and the hash
is persisted before waiting for a receipt. Restart recovery revalidates
confirmed evidence against the provider and never guesses: confirmed work is
not repeated, pending work is not automatically resent,
replacement and cancellation evidence receives an explicit terminal state, and
ambiguous evidence becomes `requires_manual_review`.

Both files are required for controlled recovery, but only the wallet file is
encrypted. The wallet file is useless without its password, and loss of either
one means the participant wallets cannot be recovered. The file and password
must be backed up separately. Neither may be stored in GitHub, Vercel, `.env`,
logs, command-line arguments, or `VITE_*` variables.

This foundation does not authorize public execution. A separate public
read-only operator command now inspects these existing files, but it never
creates them and exposes no signing or broadcast transport. All Base Sepolia
multi-wallet writes remain unavailable, and the existing contracts, deployment
scripts, addresses, and on-chain state are unchanged.

### Multi-wallet Base Sepolia read-only operator

`npm run operator:base-sepolia:read-only` supports only `preflight`, `status`,
`plan`, and `dry-run`. It connects directly to chain `84532` through
`BASE_SEPOLIA_OPERATOR_RPC_URL`, defaulting to `https://sepolia.base.org`, and
uses only a public JSON-RPC provider. The runtime contains no signer, raw-send,
funding, faucet, approval, join, withdrawal, draw, claim, or deployment method.
Its sole transaction-shaped capability is unsigned `eth_estimateGas` against
the current public state.

Before wallet planning it verifies bytecode at both recorded addresses,
`paymentToken()` linkage, token name/symbol/decimals, `DRIP_AMOUNT`,
`DRIP_COOLDOWN`, `ENTRY_PRICE`, pool capacity, active-position limit, round
count, and draw interval. It then reads an already-existing encrypted store,
manifest, checkpoint, and journal without taking an exclusive write lock or
creating a missing file. The store's project purpose is bound by one store ID
and ordered-address digest shared by the manifest, version 2 checkpoint, and
version 2 journal. Another project, network, deployment, store ID, wallet
order, pending or ambiguous journal operation, or insufficient confirmation
depth is a blocker. Version 1 local state remains supported for the existing
local lifecycle, but it is not accepted as a bound public pilot set.

The terminal report abbreviates wallet addresses. The JSON output is a local
technical report and contains public full addresses but no password, private
key, RPC URL credentials, cipher material, or API key. It reports latest and
pending nonce, ETH/dUSDC balance, exact allowance, faucet cooldown, active
membership, claimable amount, journal states, planned transaction counts,
current fee data, live gas estimates where possible, and
`NOT CURRENTLY ESTIMABLE` where a prerequisite state transition has not
occurred. Historical safety budgets are labelled separately and use a visible
2x reserve multiplier; they are not guarantees.

The public identity preflight was run against Base Sepolia and confirmed pool
1 as Open at 0/100. A secure manual initializer is now available for exactly
five new pilot wallets. It reuses the existing scrypt/AES-256-GCM store,
requires two hidden PowerShell password entries and a fixed confirmation, and
atomically publishes the four-file set only after complete validation. That
external five-wallet set was later created, and the separately guarded
two-wallet faucet/approve/join/withdraw pilot completed successfully on
2026-07-18. This is evidence only for the reversible pilot path. The future
99+1 full-lifecycle set remains a separate, unexecuted milestone. See
`docs/RUNBOOK_BASE_SEPOLIA_READ_ONLY_OPERATOR.md`.

### Separate reversible Base Sepolia smoke harness

A separate single-wallet harness now exists under
`packages/contracts/scripts/smoke`. It is not a mode of the multi-wallet
lifecycle operator and does not weaken that operator's unconditional Base
Sepolia write block. It cannot use the encrypted 100-wallet store and exposes
no draw, claim, deployment, or administration path.

Its default `npm run smoke:base-sepolia` mode is read-only. With a credential-free
HTTPS `BASE_SEPOLIA_SMOKE_RPC_URL` and a public
`BASE_SEPOLIA_SMOKE_WALLET_ADDRESS`, it validates chain `84532`, bytecode and
the two recorded addresses, `paymentToken()`, dUSDC identity and six decimals,
all fixed contract parameters and pool snapshots, current pool status/count,
wallet membership, faucet cooldown, ETH/dUSDC balances, allowance, fee data,
and a buffered gas plan. It neither requires a private key nor creates a signer.

The write form, `npm run smoke:base-sepolia -- --write-smoke`, is disabled unless
two exact documented confirmation phrases, the dedicated matching
`BASE_SEPOLIA_SMOKE_PRIVATE_KEY`, an external transaction-journal path, a clean
preflight, sufficient ETH, elapsed faucet cooldown, an Open pool, the safety
margin, and no existing fresh-run position all agree. The recorded deployment
wallet is explicitly rejected. The key is accepted only from the runtime
process environment and must never enter GitHub, Vercel, `.env`, logs,
command-line arguments, or `VITE_*` configuration.

The only write sequence is `dUSDC drip -> exact 33 dUSDC approval -> join ->
position verification -> Open-only withdraw -> exact refund and membership
verification`. The hard rejection boundary is 98 active positions; the harness
uses a stricter operating maximum of 89 to leave a ten-position margin. This
cannot remove the deployed contract's `join()` race because its ABI does not
accept an expected pool ID/count, so every state is rechecked and any mismatch
halts instead of guessing.

The journal contains no secrets and uses stable operation IDs. It has explicit
180-second receipt timeouts, at most three retries for read-only RPC calls, and
no automatic retry for any broadcast. On restart it validates transaction
identity, calldata and action-specific receipt events. Pending, replaced,
cancelled, failed and ambiguous results stop; inconclusive evidence becomes
`requires_manual_review`. Confirmed work is not sent twice.

Recovery starts from the unchanged journal and public chain evidence. Inspect
only public wallet/contract addresses and transaction hashes through links such
as `https://sepolia.basescan.org/tx/<hash>`; never include a private key or RPC
credential. No Base Sepolia preflight or write was performed in the milestone
that added this harness because the dedicated RPC and public smoke-wallet
configuration were absent.

Run commands from `packages/contracts`.

### Local deployment dry-run

```text
npm run deploy:dry-run
```

This command explicitly creates the local `hardhatOp` simulated network. It
does not read an external RPC or use Base Sepolia. It deploys `Pop33DemoUSDC`,
deploys `Pop33BasicV1`, and verifies:

- local chain ID `31337`;
- deployed token bytecode and six decimals;
- stored payment-token address;
- all compiled Demo V1 constants;
- the 3,600-second interval;
- pool 1 existence, configuration snapshot, zero escrow, and `Open` status.

Local addresses printed by this command are ephemeral and must never be copied
into the deployment register or frontend configuration.

### Local lifecycle smoke test

```text
npm run smoke:demo-v1
```

The smoke test independently deploys the local token and contract, creates 100
local wallets, gives them native gas only through local network helpers, calls
`drip()` for every wallet, executes approvals and joins, confirms `Locked`, moves
local time through all ten schedules, verifies ten unique winning positions,
confirms `Claimable`, performs all ten claims, and confirms `Finished`. It also
requires assigned prizes, claimed prizes, token balance, and accounted escrow
to reconcile to zero remaining prize funds.

### Planned Base Sepolia deployments

```text
npm run deploy:base-sepolia
npm run deploy:base-sepolia:external-token
npm run deploy:base-sepolia:demo-token
```

Do not run these commands until every checklist item is complete and the
deployment is explicitly authorized. `deploy:base-sepolia` is retained as an
alias for `deploy:base-sepolia:external-token`; both deploy only
`Pop33BasicV1` against a reviewed pre-existing token. The separate
`deploy:base-sepolia:demo-token` path deploys `Pop33DemoUSDC`, validates it,
rechecks an independent confirmation, and then deploys `Pop33BasicV1` against
the new address. No command silently substitutes one token model for another.

Required process environment variables:

| Variable | Secret | Purpose |
| --- | --- | --- |
| `BASE_SEPOLIA_RPC_URL` | possibly | HTTPS Base Sepolia RPC; never logged |
| `BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY` | yes | 32-byte deployer key; never returned or logged |
| `BASE_SEPOLIA_USDC_ADDRESS` | no | reviewed six-decimal test-token address |
| `POP33_DEMO_DRAW_INTERVAL_SECONDS` | no | must equal `3600` |
| `POP33_BASE_SEPOLIA_DEPLOY_CONFIRM` | no | must equal the documented explicit confirmation phrase |
| `POP33_DEMO_DRIP_AMOUNT_UNITS` | no | pair path only; must equal `330000000` |
| `POP33_DEMO_DRIP_COOLDOWN_SECONDS` | no | pair path only; must equal `86400` |
| `POP33_BASE_SEPOLIA_TOKEN_DEPLOY_CONFIRM` | no | pair path token confirmation; exact documented phrase |
| `POP33_BASE_SEPOLIA_POP33_DEPLOY_CONFIRM` | no | pair path POP33 confirmation; exact documented phrase and rechecked before transaction two |
| `BASESCAN_API_KEY` | yes | optional and unused until a separate verification command exists |

`packages/contracts/.env.example` documents names and safe placeholders. It is
not loaded automatically. Real `.env` variants remain ignored by Git. Secrets
must be supplied through the process environment or a controlled secret store
and must never be committed, pasted into reports, or added to frontend files.

Before submitting a deployment transaction, the script validates:

- required values are present and non-blank;
- RPC uses HTTPS, contains no URL credentials, and is not a local endpoint;
- the private key has a valid non-zero 32-byte format;
- the external token address is valid and non-zero when that variant is used;
- draw interval is exactly the approved Demo V1 value;
- the applicable explicit confirmation phrase or both independent pair-path
  confirmation phrases match;
- the connected chain ID is exactly `84532`;
- the deployer retains a conservative native-gas reserve and a buffered
  estimate for the contract about to be deployed;
- each deployed or external token address contains bytecode and exposes exactly
  six decimals;
- pair-path token metadata, faucet constants, POP33 constants, constructor
  linkage, and initial pool state match the reviewed parameters.

The pre-transaction summary excludes the RPC URL and private key. After
deployment, the script validates contract state and prints the contract,
token, chain ID, deployer, and Demo V1 parameters. Explorer verification is not
automatic. The separate verification tooling described below uses no signer or
deployment account.

## Deployment register

The following deployment was executed from the clean source commit recorded in
the table. Runtime bytecode, creation inputs, constructor linkage, constants,
and initial state were checked directly through Base Sepolia RPC.

| Version | Network | Chain ID | Demo token contract | Pop33 contract | Source commit | Deployment date | Status | Randomness | Warnings and limitations |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| POP33 Demo V1 dUSDC pair | Base Sepolia | 84532 | `0xA7FA084b34c888061757d4b5FBb08a7B53fee786` | `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F` | `1db086dd958cf34bb72bd8f7b8c9f93dab4361a0` | 2026-07-14 UTC | **DEPLOYED — PUBLIC PREVIEW ACTIVE; SOURCES VERIFIED** | temporary block-derived selection | dUSDC has no value; faucet supply is uncapped and cooldown is multi-wallet bypassable; Base Sepolia ETH required; no VRF, Automation, KYC, or production safety |

### Deployment transactions

| Operation | Transaction | Block | UTC timestamp | Gas used |
| --- | --- | ---: | --- | ---: |
| Deploy `Pop33DemoUSDC` | `0xb0be0a64b72e528ea7772baf644c659f012b16a2f1237eb3e67085092ec382bb` | 44144783 | 2026-07-14 19:37:34 | 594011 |
| Deploy `Pop33BasicV1` | `0x83a9ec10dcf85a4397e46645343ca10fc9d18e06ca37819cee0f4c2c34f49b05` | 44144873 | 2026-07-14 19:40:34 | 2748476 |
| Test one `drip()` | `0x4cb69acb733286f837fde40c7f25c26efc1a4b362104699506f090813e55fb23` | 44144891 | 2026-07-14 19:41:10 | 91850 |

Deployer: `0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB`.
Its Base Sepolia balance changed from `0.015087090763689408 ETH` before the
three writes to `0.015065960297864528 ETH` afterward. At deployment time the
account carried the standard EIP-7702 delegation marker targeting the public
MetaMask delegator `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`. The missing
outbound nonce associated with that authorization and all four earlier
contract creations were reviewed; none was a prior deployment of this bytecode.

Verified token state:

- name `POP33 Demo USD`, symbol `dUSDC`, decimals `6`;
- `DRIP_AMOUNT = 330000000` units (330 dUSDC);
- `DRIP_COOLDOWN = 86400` seconds;
- the test drip increased the deployer's balance from `0` to `330000000`
  units, emitted `DemoTokensDripped`, and set `nextDripAt` to `1784144470`.

Verified POP33 state:

- `paymentToken = 0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
- `ENTRY_PRICE = 33000000`, `MAX_POSITIONS_PER_POOL = 100`;
- `DRAW_ROUNDS = 10`, `PRIZE_PER_ROUND = 330000000`;
- `TOTAL_PRIZE_AMOUNT = 3300000000`, `DRAW_INTERVAL = 3600`;
- pool 1 is `Open`, with zero active positions and zero escrow;
- `positionCount = 0`; no approve, join, draw, or claim was performed.

### Published contract sources

Both deployed contracts are published as exact matches in BaseScan and as
exact creation/runtime matches in Sourcify:

- `Pop33DemoUSDC` at
  `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
- `Pop33BasicV1` at
  `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F`.

The published compiler settings are Solidity `0.8.28` with full compiler
version `0.8.28+commit.7893614a`, optimizer enabled with 200 runs, and EVM
version `cancun`. The published constructor arguments are:

- `Pop33DemoUSDC(330000000, 86400)`;
- `Pop33BasicV1(0xA7FA084b34c888061757d4b5FBb08a7B53fee786, 3600)`.

Before publication, the repository sources were confirmed unchanged from the
deployment source commit and the compiled runtime bytecode was compared with
both deployed addresses using the artifacts' immutable references. Publishing
the sources did not deploy a contract, send a transaction, or modify bytecode
or blockchain state. Source verification establishes source-to-bytecode
correspondence; it is not a security audit.

Future BaseScan verification uses `@nomicfoundation/hardhat-verify` with the
`default` build profile and the provider-specific `verify etherscan` task. Set
`BASE_SEPOLIA_RPC_URL` and `ETHERSCAN_API_KEY` only in the invoking process,
then run from `packages/contracts`:

```text
npm run verify:base-sepolia:demo-token
npm run verify:base-sepolia:pop33
```

The `baseSepoliaVerify` network has `accounts: []` and does not read the
deployer private key. Do not store the API key in the repository or `.env`.
The generic multi-provider task returned Blockscout `Unknown UID` while its
BaseScan and Sourcify submissions succeeded. The maintained commands therefore
target the official Etherscan API V2 provider directly: a real BaseScan error
still fails the command, while an unrelated Blockscout polling failure cannot
override the BaseScan result. Blockscout's public API subsequently reported
both addresses as fully verified, but that additional explorer is not the
required source of truth for this checkpoint.

For every later deployment, copy the row and record the exact deployed
addresses, reviewed source commit, UTC date, and one of `planned`, `active`, or
`archived`. Never overwrite an older deployment row.

## Frontend integration implementation

The integration is intentionally isolated from the legacy deployment:

- `src/demo-v1/config.ts` validates the four `VITE_POP33_DEMO_V1_*` variables
  against the reviewed Base Sepolia chain and canonical contract/token
  addresses;
- `src/demo-v1/abi.ts` contains only the typed token and Basic V1 functions and
  events needed by this interface;
- `src/hooks/useDemoV1Data.ts` performs bounded getter reads;
- `src/hooks/useDemoV1Actions.ts` performs a fresh runtime identity and
  `paymentToken()` linkage check, rechecks the connector chain immediately
  before every write, simulates the call, submits it without automatic retry,
  applies a 180-second receipt timeout, and distinguishes signature,
  confirmation, verification, rejection, revert, wrong-network, replacement,
  cancellation, manual-review, token-balance, and native-gas states;
- `#/demo-v1` exposes faucet, exact sequential approval and join, eligible
  withdrawal, permissionless test draw, and winner-only claim controls;
- `#/archive-v1` reconstructs up to 50 pools and ten rounds per pool from
  getters without browser-local winner data.

No faucet, approval, join, withdrawal, draw, or claim is sent automatically.
The approve/join control approves exactly one current entry when allowance is
insufficient, waits for confirmation and a fresh exact allowance read, reruns
the Open-pool and wallet-limit preflight, and only then requests the separate
join signature. A synchronous single-flight guard spans the entire sequence.
The public UI supports all Open-pool fill levels through `99/100`. It warns that
the next join locks a pool at `99/100`, but does not block it. Faucet, join, and
withdrawal then use bounded read-only retries to verify the semantic
post-receipt state; writes themselves are never retried.

Join verification is bound to the receipt's `PositionJoined` event rather than
assuming that the preflight pool remained selected. The frontend reads the
event's actual `poolId` and `positionId`, then re-reads the position, per-pool
active-position mapping, user active-position count, pool, token balance, and
allowance. Joins ending at 1-99 require an Open pool and zero `lockedAt`. A join
ending at 100 requires exactly 3,300 dUSDC escrow, `Locked`, non-zero
`lockedAt`, and all ten pending rounds scheduled at
`lockedAt + roundNumber * drawInterval`. If allocation changed before mining,
the UI reports the actual pool. Inconsistent receipt and final state is a
verification failure, not an ordinary success.

### Historical Public Preview reversible write procedure and first execution

This historical procedure was used for the first controlled public UI write
test on the Preview deployment from commit `e64c689`. At that time the frontend
intentionally stopped above 89 positions so the dedicated wallet could complete
an exact approval, join, and Open-pool withdrawal without risking a lock. The
verified results are recorded in `STATUS.md` and `DEVLOG.md`; this section is
evidence for that past reversible pilot, not the current public join limit.

1. Use a dedicated wallet and open `/#/demo-v1` through the confirmed Preview
   alias, not Production.
2. Connect the wallet, confirm Base Sepolia (`84532`), and verify a non-zero
   Base Sepolia ETH balance for gas.
3. Confirm that the runtime identity check succeeds and the selected pool is
   `Open`. During this historical pilot it also had to remain within the former
   89-position reversible safety margin.
4. If the wallet needs test tokens, request one faucet drip and wait until the
   UI verifies the exact 330 dUSDC increase and the new cooldown. The first
   public write session did not use the faucet.
5. Start `Approve if needed, then join`. If approval is required, confirm that
   the first wallet request is exactly 33 dUSDC. A pre-existing allowance above
   33 dUSDC is intentionally blocked.
6. Wait for the approval receipt and the fresh exact allowance read. Sign the
   separate join request only after the UI explicitly asks for it.
7. Wait until the UI reports the actual position and pool and verifies the
   exact 33 dUSDC payment, zero remaining allowance, active membership, and
   escrow. If the state is unknown, replaced, cancelled, timed out, or fails
   verification, inspect BaseScan and refresh reads; do not retry automatically.
8. Withdraw the reported position only while it remains active and its pool is
   still `Open`.
9. Wait until the UI verifies that the position is inactive, exactly 33 dUSDC
   was refunded, the active count changed, and escrow reconciles. Refresh reads
   once more and retain the transaction links for the later milestone record.

This procedure does not involve Farcaster, Production, a Vercel deployment, or
any contract/configuration change.

Known frontend limitations:

- the archive is getter-based and capped at 50 pools; backend indexing is `TO DECIDE`;
- getters do not retain historical transaction hashes, so only transactions
  submitted in the current UI session receive direct receipt links;
- replacement and cancellation stop automatic continuation and a missing
  receipt becomes manual review after 180 seconds, but the browser UI has no
  durable transaction journal across reloads;
- the current `join()` ABI cannot atomically bind the write to the preflight
  pool ID/count; the UI leaves a safety margin and detects a mismatch after the
  receipt, but cannot undo an intervening pool-state race;
- draw and claim use the guarded transaction/receipt flow, but do not yet have
  the same action-specific semantic post-receipt reconciliation as faucet,
  join, and withdrawal;
- the draw trigger remains permissionless and its temporary block-derived
  selection is explicitly unsuitable for production;
- both deployed sources are published in BaseScan and Sourcify, but source
  verification is not a security audit;
- the public Preview at deployment commit `e64c689` has verified one exact
  approval, join, and Open-pool withdrawal, but its faucet, draw, claim, pool
  locking, and full 100-position lifecycle remain publicly untested.

### Existing legacy integration preserved during migration

- `src/utils/contract.ts` contains the minimal `Pop33DemoV2` ABI and reads
  `VITE_POP33_CONTRACT_ADDRESS`.
- `src/hooks/usePop33Onchain.ts` calls the old nonpayable
  `openNextAndJoin()` function.
- `src/hooks/usePop33Stats.ts` reads old functions such as `totalJoins()`,
  `getCurrentCycleId()`, and `getActiveCyclesCount()`.
- `src/pages/ArchivePage.tsx`, `src/components/ProdView.tsx`, and related
  winner views use browser-local simulation data rather than authoritative
  `Pop33BasicV1` pools, rounds, and events.

These paths must not be silently pointed at the new address because their ABI
is incompatible. The new integration should use a separately named ABI module,
environment namespace, and visible `Demo V1` deployment label until the legacy
deployment is deliberately retired.

### Required writes

1. Call dUSDC `drip()` from `Pobierz środki testowe` only when the cooldown
   permits it.
2. Read token allowance and call the payment token's `approve()` for exactly
   the required position price when necessary.
3. Call `join()` without native value. A wallet-supported approve-plus-join
   batch may be offered, but a clear sequential fallback is required.
4. Expose `withdraw(positionId)` only for the position owner while its pool is
   `Open`.
5. Treat `executeDraw(poolId, roundNumber)` as a clearly labelled temporary
   demo action or controlled operator action; the trigger policy remains
   `TO DECIDE`.
6. Enable `claim(poolId, roundNumber)` only for the finalized, unclaimed round
   winner.

### Required reads

- payment-token address, name, symbol, decimals, user balance, and allowance;
- dUSDC `DRIP_AMOUNT`, `DRIP_COOLDOWN`, and `nextDripAt(user)`;
- `ENTRY_PRICE`, pool capacity, round count, prize values, and draw interval;
- `poolCount`, `positionCount`, `totalEscrowed`, assigned and claimed totals;
- `getPool()`, `getPosition()`, `getDrawRound()`;
- open pool IDs and bounded active-position pages;
- `activePositionsByUser`, pool/user membership, and
  `claimablePrizesByUser`;
- round winner, scheduled/executed timestamps, prize, temporary request ID,
  and claimed state.

### Events and presentation

The event/indexing layer must consume dUSDC `DemoTokensDripped` plus `PoolCreated`,
`PoolConfigurationSnapshotted`, `PositionJoined`, `PositionWithdrawn`,
`PoolLocked`, `PoolStatusChanged`, `DrawRoundExecuted`,
`WinningPositionAssigned`, and `PrizeClaimed`.

The UI must distinguish `Open`, `Locked`, `Drawing`, `Claimable`, and
`Finished`, plus `Pending` and `Finalized` round states. It should show each
round's schedule, winner, prize, claim status, transaction link obtained from
the receipt/indexer, and an actionable claim state for the connected winner.
The archive should reconstruct completed pools from pool IDs, round getters,
and events instead of browser-local winner arrays.

Frontend variables separately identifying the Demo V1 contract and token are:

- `VITE_POP33_DEMO_V1_CONTRACT_ADDRESS`;
- `VITE_POP33_DEMO_V1_TOKEN_ADDRESS`;
- `VITE_POP33_DEMO_V1_CHAIN_ID`;
- `VITE_POP33_DEMO_V1_RPC_URL`;

The current legacy variables must remain intact until the migration is tested.

### Native gas and transaction UX

The dUSDC faucet does not remove the need for Base Sepolia ETH. Users require
native gas for `drip`, `approve`, `join`, `withdraw`, `executeDraw`, and `claim`.
The UI must detect an insufficient native balance before presenting a write as
ready and explain that dUSDC cannot pay network fees. A Paymaster or sponsored
transaction flow is a separate future milestone; this plan does not assume a
specific Farcaster wallet, relayer, or third-party ETH faucet.

## Pre-deployment checklist for Base Sepolia

Before any real deployment transaction:

1. choose explicitly between the preserved external-token path and the dUSDC
   pair path; for dUSDC review its name, symbol, six decimals, 330-token drip,
   24-hour per-address cooldown, uncapped supply, and multi-wallet limitation;
2. review and sign off all Demo V1 warnings and the temporary randomness risk;
3. select and fund a dedicated deployer wallet with only the required test ETH;
4. review the final source commit and confirm the worktree is clean;
5. run compile, all contract tests, both TypeScript checks, local dry-run,
   local smoke test, root lint/build, contract production audit, and diff check;
6. review constructor arguments and the pre-transaction script summary;
7. explicitly authorize the selected deployment and set its confirmation
   phrase; the pair path requires separate confirmations for both transactions;
8. run the Base Sepolia command once and retain its transaction receipt;
9. validate deployed bytecode and all getters independently;
10. record the real addresses, commit, UTC date, transaction, and limitations
    in the deployment register;
11. add explorer verification only through a reviewed separate command;
12. complete the dedicated frontend integration checkpoint before presenting
    the new deployment as active.

Chainlink VRF, Chainlink Automation, KYC, governance, production funds,
upgradeable proxies, and new unclaimed-prize rules remain outside Demo V1.
