# Scripts

## Local-only commands

- `npm run deploy:dry-run` deploys `MockUSDC` and `Pop33BasicV1` to a fresh
  simulated `hardhatOp` network and validates the initial configuration.
- `npm run smoke:demo-v1` independently deploys the same local contracts and
  exercises 100 joins, ten draws, ten claims, and `Finished` settlement.

Both commands select the local network inside the script, require no external
RPC, and never write a frontend contract address.

## Prepared Base Sepolia command

`npm run deploy:base-sepolia` is reserved for a later explicitly authorized
public deployment. It uses the named Hardhat `baseSepolia` network and refuses
to deploy without validated environment variables, chain ID `84532`, a funded
deployer, deployed six-decimal token bytecode, the one-hour interval, and the
exact confirmation phrase.

The command does not load `.env` files automatically, print secrets, update
frontend configuration, or verify the contract in an explorer. Required
preconditions and the deployment register are documented in
`../../../docs/DEMO_V1.md`.
