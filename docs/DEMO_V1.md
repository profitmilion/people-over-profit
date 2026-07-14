# POP33 Demo V1

## Document status

This document defines the scope and records the first controlled POP33 Demo V1
deployment. The contracts are deployed, but frontend integration is pending;
this record does not authorize any additional public-chain transaction.

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

After the frontend integration milestone, Demo V1 should support:

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

This checkpoint does not implement that frontend flow.

## Deployment tooling

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
automatic and no verification plugin is installed in this checkpoint.

## Deployment register

The following deployment was executed from the clean source commit recorded in
the table. Runtime bytecode, creation inputs, constructor linkage, constants,
and initial state were checked directly through Base Sepolia RPC.

| Version | Network | Chain ID | Demo token contract | Pop33 contract | Source commit | Deployment date | Status | Randomness | Warnings and limitations |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| POP33 Demo V1 dUSDC pair | Base Sepolia | 84532 | `0xA7FA084b34c888061757d4b5FBb08a7B53fee786` | `0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F` | `1db086dd958cf34bb72bd8f7b8c9f93dab4361a0` | 2026-07-14 UTC | **DEPLOYED — FRONTEND INTEGRATION PENDING** | temporary block-derived selection | dUSDC has no value; faucet supply is uncapped and cooldown is multi-wallet bypassable; Base Sepolia ETH required; no VRF, Automation, KYC, or production safety |

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

Explorer source publication is **PENDING**. Runtime bytecode and getters are
verified on-chain, but the source is not yet published in BaseScan and the
verification plugin is not installed. After a separate review and installation
of the Hardhat verification plugin, the exact intended commands are:

```text
npx hardhat verify --network baseSepolia 0xA7FA084b34c888061757d4b5FBb08a7B53fee786 330000000 86400
npx hardhat verify --network baseSepolia 0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F 0xA7FA084b34c888061757d4b5FBb08a7B53fee786 3600
```

For every later deployment, copy the row and record the exact deployed
addresses, reviewed source commit, UTC date, and one of `planned`, `active`, or
`archived`. Never overwrite an older deployment row.

## Frontend integration plan for the next checkpoint

### Existing legacy integration to preserve during migration

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

Planned frontend variables, to be introduced only during that integration
checkpoint, should separately identify the Demo V1 contract and token, for
example:

- `VITE_POP33_DEMO_V1_CONTRACT_ADDRESS`;
- `VITE_POP33_DEMO_V1_TOKEN_ADDRESS`;
- `VITE_POP33_DEMO_V1_CHAIN_ID`;
- `VITE_POP33_DEMO_V1_RPC_URL`;
- `VITE_POP33_DEPLOYMENT_VERSION`.

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
