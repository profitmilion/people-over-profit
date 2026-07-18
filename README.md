# POP33 — People Over Profit

This repository contains the evolving POP33 product frontend, the current
Base Sepolia Demo V1 contracts and integration, local development tools, and
preserved legacy prototype layers. POP33 is under active development and is
not a production-ready product.

## Current checkpoint

The current Demo V1 runs as a standalone Web3 application on Base Sepolia. A
public Vercel Preview is available at:

https://pop33-demo-git-codex-pop33-recovery-profitmilions-projects.vercel.app

The current public routes are:

- `/#/demo-v1` — wallet connection, contract state, faucet, exact approval,
  join, eligible Open-pool withdrawal, draw, and claim controls;
- `/#/archive-v1` — getter-based pool and round archive.

One controlled public UI session has confirmed the reversible
`exact approval -> join -> withdrawal -> exact refund` flow. The complete
100-position, ten-draw, ten-claim lifecycle has been completed locally, but
has not been executed publicly on Base Sepolia.

The deployed Demo V1 sources are verified in BaseScan and published in
Sourcify. Source verification is not a security audit. The current testnet draw
randomness is manipulable and must not be used for production.

Vercel Production does not contain the current Demo V1 checkpoint. Farcaster
is not implemented and is not required by the standalone Preview.

## Sources of truth

- [Current technical status](docs/STATUS.md)
- [Product scope](docs/PRODUCT.md)
- [Approved business rules](docs/BUSINESS_RULES.md)
- [Basic V1 specification](docs/BASIC_V1_SPEC.md)
- [Demo V1 technical record and runbooks](docs/DEMO_V1.md)
- [Chronological development log](docs/DEVLOG.md)

When documents conflict, follow the repository rules in [AGENTS.md](AGENTS.md)
and do not infer new business rules from implementation details.

## Local frontend

```text
npm ci
npm run dev
```

Quality commands:

```text
npm test
npm run lint
npm run build
```

The contracts workspace and its commands are documented in
[packages/contracts/README.md](packages/contracts/README.md).

## Safety

- Use Base Sepolia only for the current Demo V1.
- dUSDC is a valueless POP33 test token and is not official Circle USDC.
- Never use mainnet funds or production credentials with this checkpoint.
- Never commit private keys, API keys, wallet material, or credential-bearing
  RPC URLs.
- Do not treat the public Preview, source verification, or local lifecycle
  tests as evidence of production readiness.

## License

The repository is covered by the project license files, including the
Business Source License terms in [LICENSE_BUSL.md](LICENSE_BUSL.md).
