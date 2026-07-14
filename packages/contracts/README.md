# POP33 contracts workspace

This isolated Hardhat 3 + TypeScript workspace contains the reproducible
contract foundation for POP33 Basic V1. It uses only the official Ethers,
Ethers Chai Matchers, Mocha, and Network Helpers plugins required by the local
compile-and-test workflow; deployment and verification plugins are deliberately
not installed at this stage.

The workspace does not force transitive dependencies across incompatible major
version ranges. Development-only audit findings from the official Mocha tree
are reported rather than hidden through unsafe overrides.

Current compatible Mocha 11 dependency ranges retain these development-only
advisories:

- `GHSA-73rr-hh4g-fpgx`: low-severity denial of service in `diff`;
- `GHSA-5c6j-r48x-rmvq`: high-severity crafted-object RCE in
  `serialize-javascript`;
- `GHSA-qj8w-gfj5-8c6v`: moderate CPU exhaustion in
  `serialize-javascript`.

They are not part of deployed contract bytecode or production runtime
dependencies. `npm audit --omit=dev` must remain clean. Revisit the Mocha and
Hardhat plugin versions when an officially compatible dependency tree contains
the patched majors; do not use `npm audit fix --force` for this workspace.

## Scope

Implemented:

- mintable six-decimal test token for local tests;
- six-decimal POP33 Demo USD (`dUSDC`) faucet token for Demo V1;
- paid positions at 33 USDC;
- automatic deterministic pool allocation;
- one active position per wallet per pool;
- at most 10 active positions per wallet;
- at most 10 simultaneously open pools;
- withdrawal and exact refund while a pool is open;
- automatic lock at 100 active positions;
- bounded active-position pagination with constant-time swap-and-pop removal;
- event-based chronological join and withdrawal history;
- immutable per-pool snapshots of all Basic V1 economic and draw parameters;
- ten hourly scheduled rounds with ordering and boundary-time enforcement;
- bounded, non-repeating winner selection for lifecycle testing;
- explicit per-round and aggregate prize accounting;
- pull-based claims during `Drawing` and `Claimable`;
- `Claimable -> Finished` after all ten prizes are claimed, with atomic release
  of all pool positions.

Intentionally not implemented:

- production-safe or verifiable randomness;
- Chainlink VRF or Automation;
- asynchronous randomness request and fulfillment recovery;
- claim expiry or alternative unclaimed-prize settlement;
- automatic explorer verification;
- network credentials or committed secrets.

The target behavior is defined in `../../docs/BASIC_V1_SPEC.md`.

## Commands

```bash
npm ci
npm run compile
npm test
npm run deploy:dry-run
npm run smoke:demo-v1
```

`deploy:dry-run` and `smoke:demo-v1` create an isolated local `hardhatOp`
network and never use Base Sepolia. The separately named
Base Sepolia commands must not be run without explicit deployment approval and
all environment safety gates described in `../../docs/DEMO_V1.md`. The
legacy-compatible `deploy:base-sepolia` path uses an external token. The
`deploy:base-sepolia:demo-token` path was used for the recorded Demo V1 token;
it must not be rerun without duplicate-deployment analysis. A transient RPC
read immediately after the first receipt stopped the pair script, so the
verified `Pop33BasicV1` deployment was safely resumed as a single transaction.

The constructor accepts the payment-token address and a non-zero draw interval
in seconds. It rejects addresses without bytecode, missing ERC-20 metadata, and
tokens whose `decimals()` value is not exactly 6. Tests and the recorded Base
Sepolia deployment use 3,600 seconds.

Every pool snapshots the current Basic V1 defaults when it is created: 33 USDC
per position, 100 positions, ten rounds, 330 USDC per round, 3,300 USDC total,
and the constructor-supplied draw interval. The current contract deliberately
has no configuration mutation function. Future price-level support requires a
controlled defaults/versioning mechanism that affects only subsequently
created pools.

## Safety notes

`MockUSDC` remains an unrestricted local-test fixture. `Pop33DemoUSDC` is a
testnet-only faucet token with no monetary value: each address can mint exactly
330 dUSDC through `drip()` once per 24 hours. It has no owner, administrator,
sale, native-token withdrawal, or arbitrary public mint function. The per-address
cooldown does not prevent multi-wallet use and the supply is intentionally
uncapped for demonstration purposes. Neither token is official Circle USDC or
the intended future mainnet payment asset. `Pop33BasicV1` has no administrative participant-
fund withdrawal function. Funds in locked and drawing pools remain explicitly
accounted and reserved for their round prizes until valid winner claims.

A future production deployment must use a previously verified, standard, non-rebasing
USDC contract. Fee-on-transfer, rebasing, and non-standard ERC-20 behavior are
not supported. The exact-refund guarantee assumes that approved token model.
The current permissionless `executeDraw()` mechanism is also test-only. It
derives entropy from caller and block attributes that can be influenced and is
therefore manipulable. Its monotonically increasing request IDs are local
correlation values, not VRF requests. Replace this entire selection path with a
verified asynchronous randomness flow before production use.

Claims use checks-effects-interactions, `SafeERC20`, and `ReentrancyGuard`.
With claim expiry and unclaimed-prize settlement still `TO DECIDE`, a pool
reaches `Finished` only when all ten prizes have been claimed. The final claim
releases the bounded set of 100 positions atomically.

The `Pop33BasicV1Harness` and all contracts under `contracts/mocks` are test-only
artifacts and must not be included in a production deployment path.

## Deployment preparation

`scripts/deploy-base-sepolia.ts` preserves the external-token variant.
`scripts/deploy-base-sepolia-demo-token.ts` prepares the two-contract dUSDC
variant. Both validate Base Sepolia, deployer gas reserves, fixed parameters,
bytecode and post-deployment state without printing private keys or RPC URLs.
Neither performs explorer verification.

`packages/contracts/.env.example` contains names and safe placeholders only.
Hardhat reads values from the process environment; the example file is not
loaded automatically. Real `.env` files remain ignored.
