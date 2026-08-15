# POP33 technology stack and decisions

Last reviewed: 2026-08-15

This document is the central, simple map of the technologies and infrastructure
choices used or planned by POP33. It explains what each item does, why it is
here, its current status, and whether it is expected to remain useful in the
final product. It does not approve missing product rules or choose providers
that have not yet been approved.

Status values are `USING`, `PLANNED`, and `TO DECIDE`. Expected final-product
roles are `YES`, `LIKELY`, `TEST/DEMO ONLY`, and `TO DECIDE`.

## Current application and contract stack

| Name | What it does | Why POP33 uses it | Status | Expected final-product role | Important notes / limitations |
| --- | --- | --- | --- | --- | --- |
| React | Builds the browser user interface from reusable components. | POP33's landing page, Demo V1, archive, and developer views are React interfaces. | USING | YES | The repository also preserves older prototype layers; React does not make every layer authoritative product behavior. |
| TypeScript | Adds checked types to frontend and operator code. | It helps catch interface, configuration, and data-shape errors before runtime. | USING | YES | Solidity contracts remain separate from TypeScript application and operator code. |
| Vite | Runs the frontend development server and creates production frontend builds. | It is the current build tool for the React application. | USING | LIKELY | A Vite build is not evidence that Vercel Production or Farcaster support has been approved. |
| wagmi | Connects React UI code to wallets and EVM-chain actions. | Demo V1 uses it for the injected-wallet path and the Farcaster wallet connector. | USING | LIKELY | Wallet writes must keep the existing network, identity, simulation, and post-receipt checks. |
| viem | Performs typed EVM encoding, public reads, simulations, and receipt/state checks. | It is shared by the frontend and read-only/operator tooling. | USING | YES | Public clients do not imply a signer. The lifecycle supervisor deliberately creates no account or wallet client. |
| TanStack React Query | Manages asynchronous cached state for React. | The application installs a `QueryClientProvider`, and wagmi uses the same query ecosystem. | USING | LIKELY | It is application state infrastructure, not an on-chain source of truth. |
| Farcaster Mini App SDK and integration | Detects the Mini App context, signals readiness, and supports the Farcaster wallet connector and metadata. | POP33 is preparing one Mini App user surface while retaining ordinary injected-wallet access. | USING | LIKELY | The branch Preview and hostname-specific association are testing evidence only. Production promotion and final Farcaster support have not been approved. |
| Solidity | Defines the EVM smart contracts. | `Pop33BasicV1` and the demo token implement the on-chain lifecycle and accounting. | USING | YES | The current contracts are active-development/testnet implementations, not automatic authority for unresolved business rules. |
| Hardhat | Compiles, tests, verifies, and provides guarded scripts for the contract workspace. | `packages/contracts` uses Hardhat for reproducible contract development and operator tooling. | USING | LIKELY | Deployment and write scripts are separately guarded; their presence is not authorization to run them. |
| OpenZeppelin Contracts | Provides reviewed ERC-20 interfaces/implementation helpers, safe transfers, and reentrancy protection. | The POP33 contracts import `IERC20`, `SafeERC20`, `ERC20`, and `ReentrancyGuard`. | USING | YES | POP33 must still test and review its own lifecycle, accounting, and integration logic. |

## Current hosting, network, and read infrastructure

| Name | What it does | Why POP33 uses it | Status | Expected final-product role | Important notes / limitations |
| --- | --- | --- | --- | --- | --- |
| Base Sepolia | Public EVM test network with chain ID `84532`. | It provides realistic public-chain testing without real product funds. | USING | TEST/DEMO ONLY | Pilot 10 uses valueless dUSDC. Base Sepolia results do not prove Base mainnet or production readiness. |
| Vercel | Builds and hosts the current public frontend previews. | It provides branch Preview deployments for mobile, wallet, and Mini App testing. | USING | LIKELY | The active Pilot 10 host is a Vercel Preview. `pop33-demo.vercel.app` remains the intended future canonical Production host, but Production has not been promoted in this checkpoint. |
| Base public RPC | Provides credential-free Base Sepolia reads. | It is the primary/default public read path where the frontend and read-only operator can use it. | USING | TEST/DEMO ONLY | Public endpoints can be rate-limited, unavailable, or temporarily stale. Current reports expose only the provider host/name, never credential-bearing URLs. Mainnet RPC infrastructure is separate and `TO DECIDE`. |
| Alchemy fallback RPC | Provides an independently operated secondary read path for lifecycle/operator verification. | Guarded read retry/failover can distinguish a primary-provider problem from chain or contract state. | USING | LIKELY | It is optional, runtime-configured, and read-only for failover. Credentials and full private RPC URLs must never be committed or printed. Transaction broadcast is not failed over or retried. |

## Planned operating components

| Name | What it does | Why POP33 plans it | Status | Expected final-product role | Important notes / limitations |
| --- | --- | --- | --- | --- | --- |
| Automatic Draw Runner V1 | Watches lifecycle state and submits only due sequential Draw operations through guarded checks. | Pilot 10 showed that manual Draw operation is not a sustainable product process. | PLANNED | LIKELY | It must separate confirmed writes from incomplete post-checks and must never treat an uncertain result as permission to resend. Its final design is not yet approved. |
| Small backend/operator | Hosts the minimum server-side operating logic that cannot safely live in a public browser. | Automatic lifecycle work and protected operational credentials require a controlled runtime. | PLANNED | LIKELY | Exact scope, custody, recovery, access control, and provider are `TO DECIDE`. It must not change approved on-chain rules. |
| Scheduler | Wakes the operator at appropriate times for lifecycle checks. | Scheduled rounds need reliable observation without relying on a user's browser session. | PLANNED | LIKELY | The provider and timing/retry policy are `TO DECIDE`; scheduling must not bypass fresh state checks. |
| POP33-operated Base Sepolia ETH faucet | Supplies limited testnet gas to approved testers. | dUSDC can be requested in the app, but users still need Base Sepolia ETH for transaction gas. | PLANNED | TEST/DEMO ONLY | Scope, abuse controls, funding, eligibility, rate limits, and operating model are `TO DECIDE`. |

## Open infrastructure decisions

| Name | What it does | Why POP33 may need a decision | Status | Expected final-product role | Important notes / limitations |
| --- | --- | --- | --- | --- | --- |
| Final backend and scheduler provider | Runs the protected operator and scheduled jobs. | A durable home is needed if Automatic Draw Runner V1 proceeds. | TO DECIDE | TO DECIDE | No cloud, serverless, database, or queue vendor is approved by current evidence. |
| Production/mainnet infrastructure | Provides mainnet RPC, monitoring, deployment, operations, and recovery. | Testnet infrastructure is not sufficient for real-value operation. | TO DECIDE | YES | Provider choices, redundancy, security controls, release gates, and costs are not yet approved. |
| Paymaster / gas sponsorship | Could pay or simplify user transaction gas. | It may reduce onboarding friction. | TO DECIDE | TO DECIDE | No paymaster technology, sponsor policy, budget, abuse control, or user promise is approved. |

## Documentation responsibilities

- `docs/STATUS.md` records the current state of the project: implemented
  coverage, verified environment state, known gaps, and risks.
- `docs/DEVLOG.md` is the chronological history of meaningful completed work
  and approved decisions. It is not a full commit history or a copy of STATUS.
- `docs/TECH_STACK_AND_DECISIONS.md` records technologies, infrastructure
  choices, their status, and the reasons for using them.

Product scope belongs in `docs/PRODUCT.md`; approved and unresolved business
rules belong in `docs/BUSINESS_RULES.md`. Large sections should not be copied
between these documents.
