# Scripts

## Local-only commands

- `npm run deploy:dry-run` deploys `Pop33DemoUSDC` and `Pop33BasicV1` to a fresh
  simulated `hardhatOp` network and validates the initial configuration.
- `npm run smoke:demo-v1` independently deploys the same local contracts and
  exercises 100 faucet drips, 100 joins, ten draws, ten claims, and `Finished`
  settlement.

Both commands select the local network inside the script, require no external
RPC, and never write a frontend contract address.

## Base Sepolia commands

- `npm run deploy:base-sepolia` and the explicit alias
  `npm run deploy:base-sepolia:external-token` retain the existing one-contract
  path using a previously deployed external six-decimal token.
- `npm run deploy:base-sepolia:demo-token` prepares two sequential deployments:
  POP33 Demo USD (`dUSDC`) and then `Pop33BasicV1`. It checks chain ID `84532`,
  a conservative native-token reserve, exact fixed parameters, deployed
  bytecode and state, and two separate confirmation phrases. The second phrase
  is checked again immediately before the second transaction.

The dUSDC pair deployment recorded in `../../../docs/DEMO_V1.md` has already
occurred. Do not rerun this command for that version: the script starts by
deploying another token and is not a resume command. During the recorded run,
a transient RPC read after the successful token receipt stopped execution
before POP33; the existing token was independently verified and only the
second deployment was resumed. Any future run requires a new explicit version
decision and duplicate-deployment review.

These commands do not load `.env` files automatically, print secrets, update
frontend configuration, or verify the contract in an explorer. Required
preconditions and the deployment register are documented in
`../../../docs/DEMO_V1.md`.
