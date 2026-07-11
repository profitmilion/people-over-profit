# POP33 Development Status

Last reviewed: 2026-07-11

Branch reviewed: `codex/pop33-recovery`

Status: active development

## Summary

The repository contains an evolving React frontend, historical local prototype
layers, developer tooling, and an initial Base Sepolia integration. The local
simulation is a development aid, not a separate target product model.

The demo is expected to converge on the same business flow and architecture as
the future mainnet product. Several approved rules are not yet represented in
the current implementation.

## Business-rule implementation matrix

| Approved rule | Implementation status | Notes |
| --- | --- | --- |
| One payment creates one position in a specific pool/cycle | **partial** | The local prototype creates a participant entry and the contract exposes a join operation, but the current contract join is nonpayable and the end-to-end stablecoin flow is absent. |
| One primary participation action creates one position per successful use | **partial** | In `/demo`, `POP IT` now invokes only the Base Sepolia transaction and does not mutate local simulation state. The current contract join remains nonpayable, so the approved payment flow is still absent. |
| Automatic assignment to an available pool | **partial** | The local smart-join flow selects an available cycle and may create the next cycle within its local system limit. The exact algorithm and authoritative on-chain enforcement remain unresolved. |
| Maximum one active position per user in the same pool | **partial** | The local smart-join flow excludes an open cycle that already contains the local user ID. The contract does not yet authoritatively expose or enforce the complete approved rule through this repository's integration. |
| Maximum 10 active positions per user | **partial** | The frontend can read `getActiveCyclesCount(address)`, but the available ABI and missing contract source do not establish complete authoritative enforcement of the limit or lifecycle. `/demo` therefore does not invent a local substitute for this check. The developer simulation retains its separate local limit behavior. |
| Position leaves the active limit when its pool reaches `finished` | **partial** | The local layer excludes positions in `finished` cycles from the active count and can re-enable participation. Authoritative on-chain lifecycle enforcement is not yet present. |
| The first draw does not release an active position | **partial** | In the local lifecycle, a cycle remains non-`finished` through intermediate draws, so its position continues to count. Equivalent authoritative on-chain enforcement is not yet present. |
| Pool remains open/in collection until target participation | **partial** | The local prototype keeps cycles open until its configured capacity is reached, but the authoritative on-chain lifecycle and final target value are not implemented here. |
| Withdraw one position while its pool is open | **not implemented** | No withdrawal action is present in the inspected UI, local primary flow, or contract ABI. |
| Withdrawal removes the position from the pool | **not implemented** | Requires product and contract implementation. |
| Withdrawal releases one slot from the user's active-position limit | **not implemented** | Requires active-position accounting and withdrawal implementation. |
| Withdrawal returns the paid stablecoin | **not implemented** | The current join is nonpayable and no refund path is exposed. |
| No withdrawal after the pool is full and locked | **not implemented** | The local prototype changes state when full, but there is no withdrawal operation or authoritative contract enforcement to test this restriction. |
| Demo mirrors the final/mainnet product model | **partial** | The `/demo` participation action is now Base Sepolia-only, while the browser-local simulation is confined to `/demo?view=dev`. Stablecoin payment, withdrawals, and complete authoritative position lifecycle rules remain missing. |
| Demo differences limited mainly to network, test tokens, safety parameters, and developer tools | **partial** | This is the approved direction; the current historical simulation and unfinished contract integration have not yet fully converged on it. |

## Implemented

- React, TypeScript, and Vite frontend.
- Hash-based routing for landing, demo, and archive.
- Responsive landing and demo UI.
- Browser-local cycle simulation for development.
- Local cycle selection and participant creation.
- Automatic and manual simulated draws.
- Developer panel with fake participants and reset controls.
- Winners history and archive UI.
- Injected wallet connection.
- Base Sepolia wagmi configuration.
- On-chain `openNextAndJoin()` transaction call.
- Basic on-chain aggregate and per-wallet reads.
- Transaction pending, confirmation, and error states.
- Separation of the Base Sepolia `POP IT` action from browser-local simulation
  state.
- A synchronous single-intent guard covering wallet approval, submission, and
  confirmation to prevent rapid duplicate transaction requests.
- Wallet network readiness is derived from the active connector account chain,
  with a second `connector.getChainId()` check immediately before
  `writeContractAsync`; unsupported networks cannot open a transaction request.
- Local cycle presentation and controls confined to `/demo?view=dev` and
  explicitly labelled as non-on-chain developer simulation.
- The local simulation component no longer depends on wallet or on-chain
  transaction status and its `POP IT` action is governed only by local state.

## Partial / in progress

- alignment of the demo with the intended mainnet product architecture;
- expansion of the authoritative on-chain user view beyond the currently
  available aggregate, cycle ID, and active-cycle count reads;
- contract-driven pool lifecycle;
- stablecoin-based position creation;
- authoritative on-chain enforcement of the 10-active-position limit;
- authoritative on-chain enforcement of automatic allocation, one position per
  user per pool, and the active-position lifecycle;
- consistent configuration across UI, hooks, and environment variables;
- on-chain draw implementation;
- unified cycle and position domain model;
- Farcaster integration;
- production readiness.

## Not implemented

- withdrawal of an individual position from an open pool;
- removal of a withdrawn position from authoritative pool state;
- release of the withdrawn position from the user's limit of 10;
- stablecoin refund on withdrawal;
- contract-enforced prohibition of withdrawal after pool lock;
- end-to-end real or test stablecoin payment flow;
- final business parameters for pool capacity, pricing, prizes, and draws.

## Legacy or alternative code retained

- `src/store/cyclesStore.ts`;
- `src/mock/mockService.ts`;
- `src/features/cycles/*`;
- compatibility fields in `src/types/core.ts`.

These files are retained intentionally. They must not be deleted solely because
newer code exists.

## Known inconsistencies and risks

- several incompatible cycle models exist in parallel;
- prototype participant and draw limits conflict across files;
- entry amounts conflict across documentation, UI copy, and configuration;
- the Base Sepolia contract address is hard-coded in source;
- declared environment variables are not consumed consistently;
- `VITE_POP33_ENTRY_VALUE_WEI` is consumed but absent from `.env.example`;
- the Base Sepolia `POP IT` action is separated from local simulation state,
  but complete contract-side enforcement of the approved 10-position limit
  and lifecycle cannot be verified from the available ABI without contract
  source;
- the current contract join is nonpayable;
- a transaction that remains pending for a very long time can keep the primary
  action locked until a receipt or provider error is observed;
- handling for replaced or cancelled transactions and controlled recovery from
  prolonged pending state is not yet implemented;
- automatic wallet network switching is not implemented; users must switch to
  Base Sepolia explicitly in their wallet;
- withdrawal/refund behavior is absent;
- the README contains historical and Vite-template content;
- some visible strings show character-encoding problems;
- no automated test command is defined;
- smart-contract source is not present in this repository.

The previous wrong-network false positive was caused by using `useChainId()`
with a wagmi configuration containing only Base Sepolia. An unsupported active
connector network could therefore be represented as the configured chain. The
Base Sepolia action now uses the actual connector account chain reactively in
the UI and rechecks the connector directly before sending.

## Open decisions

- `TO DECIDE`: supported stablecoin and position price.
- `TO DECIDE`: target pool capacity.
- `TO DECIDE`: draw and prize parameters.
- `TO DECIDE`: exact automatic pool-allocation algorithm and its authoritative
  on-chain enforcement.
- `TO DECIDE`: randomness and payout architecture.
- `TO DECIDE`: canonical configuration source.
- `TO DECIDE`: contract repository and versioning process.
- `TO DECIDE`: testing strategy.
- `TO DECIDE`: production, security, and compliance milestones.

## Verification commands

- `npm run lint`
- `npm run build`
- `git diff --check`

There is currently no automated test script in `package.json`.
