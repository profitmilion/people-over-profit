# POP33 Demo V1

## Document status

This document defines the scope and deployment-readiness plan for the first
controlled POP33 Demo V1 deployment. It does not record an actual deployment
and does not authorize a public-chain transaction.

Approved product behavior remains governed by `BUSINESS_RULES.md` and
`BASIC_V1_SPEC.md`. Open product decisions remain `TO DECIDE` and are collected
in `BUSINESS_RULES.md` rather than resolved here.

## Purpose and environment

POP33 Demo V1 is planned for Base Sepolia, chain ID `84532`. It is a technical
testnet demonstration only:

- it uses test USDC-compatible tokens with no monetary value;
- it is not a production product or a service offering real prizes;
- it does not accept real payments and provides no economic guarantees;
- its current winner-selection mechanism is temporary, manipulable, and not
  production-safe;
- it has no KYC, proof-of-personhood, or multi-account protection;
- it does not establish a legal or production operating model.

The exact six-decimal Base Sepolia test-token address is `TO DECIDE` and must be
verified before deployment. The local `MockUSDC` is unrestricted and must never
be deployed or presented as the selected public test token.

## Demo V1 technical configuration

All token amounts are stored in the smallest six-decimal token units.

| Parameter | Demo V1 value |
| --- | ---: |
| Positions per pool | 100 |
| Position price | 33,000,000 units (33 test USDC) |
| Full pool | 3,300,000,000 units (3,300 test USDC) |
| Draw rounds | 10 |
| Prize per round | 330,000,000 units (330 test USDC) |
| Different winning positions | 10 |
| Base Sepolia draw interval | 3,600 seconds |

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
2. approving and paying test USDC for a position;
3. filling a pool with 100 positions;
4. observing the transition to `Locked`;
5. executing ten scheduled rounds;
6. displaying the ten winning positions and wallets;
7. claiming all ten credited prizes;
8. observing the transition to `Finished`;
9. displaying the completed pool and round history in an on-chain archive.

This checkpoint does not implement that frontend flow.

## Deployment tooling

Run commands from `packages/contracts`.

### Local deployment dry-run

```text
npm run deploy:dry-run
```

This command explicitly creates the local `hardhatOp` simulated network. It
does not read an external RPC or use Base Sepolia. It deploys `MockUSDC`,
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

The smoke test independently deploys the local token and contract, creates and
funds 100 local wallets, executes approvals and joins, confirms `Locked`, moves
local time through all ten schedules, verifies ten unique winning positions,
confirms `Claimable`, performs all ten claims, and confirms `Finished`. It also
requires assigned prizes, claimed prizes, token balance, and accounted escrow
to reconcile to zero remaining prize funds.

### Planned Base Sepolia deployment

```text
npm run deploy:base-sepolia
```

Do not run this command until every item in the pre-deployment checklist is
complete and the deployment is explicitly authorized. The command is separate
from the local dry-run, connects only to the named `baseSepolia` Hardhat
network, and refuses to deploy unless all safety checks pass.

Required process environment variables:

| Variable | Secret | Purpose |
| --- | --- | --- |
| `BASE_SEPOLIA_RPC_URL` | possibly | HTTPS Base Sepolia RPC; never logged |
| `BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY` | yes | 32-byte deployer key; never returned or logged |
| `BASE_SEPOLIA_USDC_ADDRESS` | no | reviewed six-decimal test-token address |
| `POP33_DEMO_DRAW_INTERVAL_SECONDS` | no | must equal `3600` |
| `POP33_BASE_SEPOLIA_DEPLOY_CONFIRM` | no | must equal the documented explicit confirmation phrase |
| `BASESCAN_API_KEY` | yes | optional and unused until a separate verification command exists |

`packages/contracts/.env.example` documents names and safe placeholders. It is
not loaded automatically. Real `.env` variants remain ignored by Git. Secrets
must be supplied through the process environment or a controlled secret store
and must never be committed, pasted into reports, or added to frontend files.

Before submitting a deployment transaction, the script validates:

- required values are present and non-blank;
- RPC uses HTTPS, contains no URL credentials, and is not a local endpoint;
- the private key has a valid non-zero 32-byte format;
- the token address is valid and non-zero;
- draw interval is exactly the approved Demo V1 value;
- the explicit deployment confirmation phrase matches;
- the connected chain ID is exactly `84532`;
- the deployer has native gas funds;
- the token address contains bytecode and exposes exactly six decimals.

The pre-transaction summary excludes the RPC URL and private key. After
deployment, the script validates contract state and prints the contract,
token, chain ID, deployer, and Demo V1 parameters. Explorer verification is not
automatic and no verification plugin is installed in this checkpoint.

## Deployment register

No Pop33BasicV1 Base Sepolia deployment has been performed by this checkpoint.
Do not replace `not deployed` or `TO DECIDE` with a guessed address.

| Version | Network | Chain ID | Contract | Token | Source commit | Deployment date | Status | Randomness | Warnings and limitations |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| POP33 Demo V1 | Base Sepolia | 84532 | not deployed | `TO DECIDE` | record reviewed HEAD at deployment | not deployed | planned | temporary block-derived selection | test tokens only; no KYC or multi-account protection; not production-safe |

For every actual deployment, copy the row and record the exact deployed
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

1. Read token allowance and call the payment token's `approve()` for exactly
   the required position price when necessary.
2. Call `join()` without native value.
3. Expose `withdraw(positionId)` only for the position owner while its pool is
   `Open`.
4. Treat `executeDraw(poolId, roundNumber)` as a clearly labelled temporary
   demo action or controlled operator action; the trigger policy remains
   `TO DECIDE`.
5. Enable `claim(poolId, roundNumber)` only for the finalized, unclaimed round
   winner.

### Required reads

- payment-token address, decimals, user balance, and allowance;
- `ENTRY_PRICE`, pool capacity, round count, prize values, and draw interval;
- `poolCount`, `positionCount`, `totalEscrowed`, assigned and claimed totals;
- `getPool()`, `getPosition()`, `getDrawRound()`;
- open pool IDs and bounded active-position pages;
- `activePositionsByUser`, pool/user membership, and
  `claimablePrizesByUser`;
- round winner, scheduled/executed timestamps, prize, temporary request ID,
  and claimed state.

### Events and presentation

The event/indexing layer must consume `PoolCreated`,
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

## Pre-deployment checklist for Base Sepolia

Before any real deployment transaction:

1. explicitly approve the exact Base Sepolia test-token address and confirm it
   is a standard, non-rebasing, non-fee token with six decimals;
2. review and sign off all Demo V1 warnings and the temporary randomness risk;
3. select and fund a dedicated deployer wallet with only the required test ETH;
4. review the final source commit and confirm the worktree is clean;
5. run compile, all contract tests, both TypeScript checks, local dry-run,
   local smoke test, root lint/build, contract production audit, and diff check;
6. review constructor arguments and the pre-transaction script summary;
7. explicitly authorize the deployment and set the confirmation phrase;
8. run the Base Sepolia command once and retain its transaction receipt;
9. validate deployed bytecode and all getters independently;
10. record the real addresses, commit, UTC date, transaction, and limitations
    in the deployment register;
11. add explorer verification only through a reviewed separate command;
12. complete the dedicated frontend integration checkpoint before presenting
    the new deployment as active.

Chainlink VRF, Chainlink Automation, KYC, governance, production funds,
upgradeable proxies, and new unclaimed-prize rules remain outside Demo V1.
