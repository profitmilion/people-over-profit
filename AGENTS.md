# POP33 Repository Instructions

## Project status

POP33 is under active development and is not a finished product.

The repository contains the evolving product UI and on-chain integration, a
developer panel, and older local prototype mechanisms. The current code is
implementation evidence, but it is not automatically the authoritative
business specification.

## Mandatory rules

- Do not remove legacy mechanisms unless explicitly requested.
- Do not consolidate competing implementations without explicit approval.
- Do not change approved business rules based only on the current code.
- Do not invent missing product or business rules. Mark unresolved matters as
  `TO DECIDE`.
- Treat the local simulation as a developer tool and historical prototype
  layer, not as a separate target product model.
- Keep the demo/testnet flow aligned with the intended mainnet architecture.
  Differences should be limited mainly to the network, test assets, safety
  parameters, and additional developer tooling.
- Preserve existing user changes in the worktree.
- Do not commit unless explicitly requested.
- Before work, confirm the actual repository path, active branch, full HEAD,
  worktree status, and synchronization with the intended remote branch. Never
  assume a checkpoint from memory or an earlier session.
- Keep Vercel Preview, Vercel Production, and Farcaster status separate. A
  verified Preview does not imply a Production release or Farcaster support.
- Never commit private keys, API keys, wallet material, credential-bearing RPC
  URLs, or other secrets. Read required credentials only at runtime.

## Source-of-truth responsibilities

- Explicit current user instructions have highest priority.
- `docs/STATUS.md` is the current technical snapshot.
- `docs/DEVLOG.md` is the chronological milestone history.
- `docs/PRODUCT.md` defines product vision and current scope.
- `docs/BUSINESS_RULES.md` contains approved business rules and explicit open
  decisions.
- `docs/BASIC_V1_SPEC.md` specifies Basic V1 behavior.
- `docs/DEMO_V1.md` is the technical description, deployment record, and
  runbook for the current Demo V1.
- `README.md` is a concise repository entry point, not a detailed
  specification.
- Current implementation is evidence of implementation status, not authority
  to change product rules.

When sources conflict, preserve the implementation unless a change is
requested, document the conflict, and use `TO DECIDE` for unresolved policy.

## Architecture boundaries

- Primary local prototype and developer simulation:
  `src/hooks/useCycles.tsx`, `src/types/core.ts`, and
  `src/utils/storage.ts`.
- On-chain integration: `src/wagmi.ts`, `src/hooks/usePop33Onchain.ts`,
  `src/hooks/usePop33Stats.ts`, and `src/utils/contract.ts`.
- Developer tooling: `src/components/DevPanel.tsx`.
- Current Demo V1 frontend: `src/demo-v1`, `src/pages/DemoV1Page.tsx`, and
  `src/pages/ArchiveV1Page.tsx`.
- Current Basic V1 contracts and operator tooling: `packages/contracts`.
- Legacy or alternative implementations include `src/store`, `src/mock`, and
  selected files under `src/features`.

Do not assume that all existing layers currently implement identical rules.
Do not delete older layers solely because newer code exists.

## Business-rule changes

Before changing product behavior:

1. Check `docs/BUSINESS_RULES.md` for approved rules.
2. Distinguish a missing implementation from an unresolved business decision.
3. Do not replace approved behavior with a prototype shortcut.
4. Update `docs/STATUS.md` when implementation coverage changes.

## Verification

For application changes, run as appropriate:

- `npm run lint`
- `npm test`
- `npm run build`

For changes in `packages/contracts`, run as appropriate from that workspace:

- `npm run compile`
- `npm test`
- `npx tsc --noEmit`
- `npm audit --omit=dev`

The repository has focused frontend domain tests and a comprehensive
contract/operator/smoke suite. Broader browser and component testing remains
an open engineering decision; do not describe the repository as having no
automated tests.

For documentation-only changes, at minimum run:

- `git diff --check`

## Documentation maintenance

- Update `docs/PRODUCT.md` when product scope or the intended user journey
  changes.
- Update `docs/BUSINESS_RULES.md` only when a rule is confirmed or its decision
  status changes.
- Update `docs/STATUS.md` when implementation coverage, known gaps, or the
  reviewed branch changes.

## Product evolution and newly discovered issues

- During analysis and implementation, report newly discovered problems,
  threats, edge cases, and possible improvements. Describe their potential
  impact and propose possible solutions.
- Do not independently change approved business rules or implement new business
  logic without an explicit decision.
- After a change is approved, update the relevant documentation before or
  together with the code change.
- Treat approved rules as the current product baseline, not as rules that can
  never change.
- If a discovered security threat conflicts with an approved rule, stop that
  part of the implementation, describe the conflict, and present safer options
  for a decision.
