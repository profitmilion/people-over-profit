# POP33 Product

## Document status

This is a working product overview. POP33 is under active development and is
not a finished product. Unresolved matters are marked `TO DECIDE`.

This document records the current and approved product model. Longer-term
direction, future ideas, possible milestones, and unresolved product questions
are kept separately in `docs/PRODUCT_VISION_AND_ROADMAP.md`; inclusion there
does not approve an implementation requirement or change the rules here.

## Product vision

POP33 is intended to be a transparent, community-oriented product combining
crowdfunding-style participation with draw mechanics. It is designed around a
repeatable cycle in which users fund positions in pools, pools collect the
required participation, and completed pools proceed to draws and results.

The broader project vision references Base, Farcaster, PMN, Auto-HODL, DCA,
community redistribution, and governance. Their final scope and mechanics are
`TO DECIDE` unless explicitly approved in `docs/BUSINESS_RULES.md`.

The longer-term product vision retains a large monthly community pool. Its
exact size, funding, eligibility, distribution, and relationship to Basic V1
remain `TO DECIDE`; no values for that future pool should be inferred from the
testnet implementation or older marketing drafts.

## Product architecture principle

The POP33 demo is intended to mirror the final product and future mainnet
architecture as closely as practical. It must not be designed around different
business logic or a disposable, substantially simplified user journey.

Differences between the demo/testnet and the future product should be limited
mainly to:

- a test network instead of mainnet;
- test tokens instead of real funds;
- safety parameters appropriate for testing;
- additional developer and diagnostic tools.

The local browser simulation is a developer tool and historical prototype
layer. It is not a separate target product model.

## Approved participation model

- The user participates through one primary participation action.
- One successful use of that action and one user payment create one position.
- The system automatically assigns the position to an appropriate open
  pool/cycle; the user does not manually select a pool.
- If no appropriate open pool exists, the system may open the next pool in
  accordance with system limits.
- At most 10 pools may be open simultaneously. Assignment selects the oldest
  open pool in which the wallet has no active position; a new pool is created
  only when no existing open pool qualifies.
- One user or wallet may hold at most one active position in the same pool.
- A subsequent position from that user must be assigned to another appropriate
  pool.
- A user may hold at most 10 active positions at the same time.
- Subsequent successful uses of the primary action create subsequent positions
  until that limit is reached.
- Once the user has 10 active positions, creation of another position is
  blocked.
- A pool remains open and in its collection phase until it reaches its target
  number of participants.
- While the pool remains open, a participant may withdraw an individual
  position.
- Withdrawing before pool lock removes the participant from that pool, releases
  one slot in the user's limit of 10 active positions, and returns the paid
  stablecoin.
- After withdrawal, the wallet may join the same pool again while it remains
  open. Re-entry creates a new unique position rather than reusing the old one.
- Once the pool is full and locked, withdrawal is no longer possible.
- Basic V1 pools contain 100 positions at 33 USDC each.
- Each full Basic V1 pool allocates its 3,300 USDC across 10 sequential draws:
  one different winning position and 330 USDC per draw, with no fees.
- Winners claim credited prizes; winner selection does not automatically send
  the prize.
- The pool lifecycle is
  `Open -> Locked -> Drawing -> Claimable -> Finished`.
- A position ceases to count toward the limit of 10 when the user withdraws it
  from an open, unlocked pool or when its pool completes the entire approved
  draw process and reaches `finished` status.
- The first draw alone does not release the position from the limit.
- Participation becomes available again when at least one position ceases to
  be active.

Detailed Basic V1 behavior is specified in `docs/BASIC_V1_SPEC.md`. Active
candidate sets are bounded to 100 positions per pool, while chronological join
and withdrawal history is reconstructed primarily from events. The technical
term remains `position`; the final user-facing name, such as `ticket`, `entry`,
or `coupon`, is `TO DECIDE`.

## Intended user journey

1. A user connects a supported wallet.
2. The user sees one primary participation action.
3. One successful use of that action creates one paid position.
4. The system automatically assigns the position to an appropriate open pool,
   opening the next pool within system limits if necessary.
5. Subsequent successful uses create subsequent positions in other appropriate
   pools, up to the limit of 10 active positions.
6. At 10 active positions, creation of another position is blocked.
7. A slot becomes available after the user withdraws a position from an open,
   unlocked pool or after that position's pool completes the full draw process
   and reaches `finished` status. The first draw alone does not release it.
8. Results remain available through the product's result/archive experience.

## Current repository capabilities

The repository currently provides:

- a public landing page whose product CTA points only to `#/demo-v1`;
- one public product flow at `#/demo-v1` and one public on-chain archive at
  `#/archive-v1`;
- injected-wallet connection and Base Sepolia network support;
- Farcaster Mini App SDK readiness plus the official Farcaster Wagmi connector,
  while retaining the injected-wallet web path;
- contract-backed Demo V1 reads, faucet, exact approval, join, eligible
  Open-pool withdrawal, draw, and claim controls;
- one confirmed public reversible approval, join, and exact-refund flow;
- a local cycle simulation isolated at `#/demo?view=dev`;
- a legacy notice at ordinary `#/demo`, with no old-contract wallet action;
- a browser-local DEV archive at `#/archive`, separate from the public
  on-chain archive;
- a developer panel;
- a getter-based draw and pool archive;
- a local operator that exercises the complete Basic V1 lifecycle.

The Public Pilot 10 profile is deployed on Base Sepolia and connected to its
branch Vercel Preview. Pilot 10 Pool 1 completed its ten-Draw, ten-Claim
lifecycle and reached `Finished` with zero accounted escrow. The complete
100-position lifecycle has not been executed publicly on Base Sepolia. Current
implementation coverage and limitations are tracked in `docs/STATUS.md`.

## Intended users

- community participants;
- users new to Web3;
- developers and testers;
- future Farcaster users.

Detailed personas, eligibility, and geographic availability are `TO DECIDE`.

## Environments

### Local development

May include browser-local state, simulated participants, accelerated safety
parameters, and developer controls. These tools should exercise the intended
product model rather than define an alternative business model. The preserved
local simulator is explicitly labelled as a developer tool, may use
`localStorage`, and does not represent the current Demo V1 economics or full
on-chain lifecycle.

### Base Sepolia demo

The current integration targets Base Sepolia and uses a demo contract. It is an
early implementation and does not yet cover all approved product behavior.
POP33 Demo V1 is prepared to use the POP33-owned, six-decimal faucet token
POP33 Demo USD (`dUSDC`). It has no monetary value and is not official Circle
test USDC. A preserved alternative deployment path accepts a separately
reviewed external six-decimal test token. Both are distinct from the intended
future mainnet USDC payment asset.

The first controlled `Pop33BasicV1` testnet release is named POP33 Demo
V1. Its explicitly non-production scope, test-token limitations, deployment
status, and intended end-to-end demonstration are defined in `docs/DEMO_V1.md`.
The original 100-position Demo V1 is deployed on Base Sepolia and remains a
historical deployment. The separate 10-position Pilot 10 contract is now the
current branch Preview configuration and has completed Pool 1 on Base Sepolia.
The current release remains on Vercel Preview; Production remains separate and
has not been promoted by this checkpoint.

The public frontend surface for this release consists of the landing page,
`#/demo-v1`, and `#/archive-v1`. Preserved legacy contract components and the
browser-local simulator remain development/history layers and are not
alternative public POP33 products.

### Future production

Base mainnet is the intended direction reflected in the project configuration
and vision. The production contract, launch scope, deployment process, and
release criteria are `TO DECIDE`.

## Current non-goals and limitations

The current prototype does not yet:

- represent final tokenomics;
- implement confirmed production payments and refunds end to end;
- prove production-grade randomness;
- complete the public 100-position, ten-draw, ten-claim lifecycle;
- provide a public Base Sepolia multi-wallet lifecycle operator;
- provide production KYC, identity, or multi-wallet protection;
- define legal classification or geographic availability;
- represent audited, production-ready smart-contract behavior.

## Product principles

Existing project materials emphasize fairness, transparency, accessibility,
community benefit, education, and equal opportunity. How principles not already
captured by approved rules translate into enforceable mechanics is
`TO DECIDE`.

## Product evolution

This documentation describes the currently approved direction of POP33, but it
is not a complete or immutable specification of the final product. Development,
testing, audits, and contact with users may reveal new functional requirements,
edge cases, technical problems, security threats, payment, refund, or pool
lifecycle problems, user needs, legal or operational requirements, and
opportunities to improve product simplicity and usability.

Approved rules are the current product baseline. They may be deliberately
changed after analysis and an explicit decision by the creator. Newly
discovered issues do not change approved rules by themselves.

## Open product decisions

- Basic V1 uses USDC, 33 USDC per position, 100 positions per pool, 10 draws,
  and one 330 USDC prize in each draw.
- POP33 Demo V1 uses the deployed own dUSDC contract recorded in
  `docs/DEMO_V1.md`. Selection of any external
  official test-USDC address remains `TO DECIDE` for the alternative path.
- Basic V1 Base Sepolia uses a 1-hour draw interval; a future mainnet deployment
  is planned to use 24 hours.
- `TO DECIDE`: randomness and verification mechanism; Chainlink VRF must be
  evaluated in a future stage.
- `TO DECIDE`: draw-trigger policy and possible Chainlink Automation use.
- `TO DECIDE`: claim expiry and unclaimed-prize settlement.
- `TO DECIDE`: behavior of incomplete or stalled pools.
- Basic V1 uses the approved oldest-qualifying-pool algorithm with no more than
  10 simultaneously open pools; the deployed Demo V1 contract enforces it on-chain.
- `TO DECIDE`: final user-facing name for a `position`.
- The first Farcaster scope is the existing Vite product inside a Mini App:
  SDK `ready()`, Farcaster Ethereum wallet connector, Base Sepolia-only manifest
  metadata, and the same web fallback. Notifications, social login, and a new
  application shell are outside the first pilot.
- `TO DECIDE`: PMN, Auto-HODL, and DCA mechanics.
- `TO DECIDE`: production rollout criteria.
- `TO DECIDE`: legal, eligibility, and geographic requirements.
