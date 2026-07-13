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
- paid positions at 33 USDC;
- automatic deterministic pool allocation;
- one active position per wallet per pool;
- at most 10 active positions per wallet;
- at most 10 simultaneously open pools;
- withdrawal and exact refund while a pool is open;
- automatic lock at 100 active positions;
- bounded active-position pagination with constant-time swap-and-pop removal;
- event-based chronological join and withdrawal history.

Intentionally not implemented:

- randomness or winner selection;
- Chainlink VRF or Automation;
- draw execution;
- prize accounting and claim;
- deployment scripts or network credentials.

The target behavior is defined in `../../docs/BASIC_V1_SPEC.md`.

## Commands

```bash
npm ci
npm run compile
npm test
```

The constructor accepts the payment-token address and a non-zero draw interval
in seconds. It rejects addresses without bytecode, missing ERC-20 metadata, and
tokens whose `decimals()` value is not exactly 6. Tests use 3,600 seconds for
the planned Base Sepolia configuration.

## Safety notes

`MockUSDC` is unrestricted and mintable. It is for local automated tests only
and is not a production token. `Pop33BasicV1` has no administrative participant-
fund withdrawal function. Funds in locked pools remain escrowed for the future
draw and claim stages.

A future deployment must use a previously verified, standard, non-rebasing
USDC contract. Fee-on-transfer, rebasing, and non-standard ERC-20 behavior are
not supported. The exact-refund guarantee assumes that approved token model.
The `Pop33BasicV1Harness` and all contracts under `contracts/mocks` are test-only
artifacts and must not be included in a production deployment path.
