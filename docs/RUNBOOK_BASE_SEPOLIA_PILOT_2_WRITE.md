# Base Sepolia two-wallet write pilot runbook

## Completed checkpoint — do not rerun

Piotr completed this reversible testnet pilot on 2026-07-18 for exactly wallet
indices 0 and 1 from the five-wallet set, chain 84532, the recorded dUSDC and
POP33 Demo V1 contracts, and pool 1. This runbook now records historical
execution and recovery evidence. It is not authorization to run the launcher
again, use wallets 2-4, or start a larger lifecycle test.

The only available write sequence for each selected wallet is:

1. dUSDC faucet for exactly 330 dUSDC;
2. approval of exactly 33 dUSDC to the recorded POP33 contract;
3. join of the currently Open pool, which must be pool 1;
4. receipt, event, position, balance, allowance, pool-count, and escrow checks;
5. withdrawal while pool 1 remains Open;
6. verification of the 33 dUSDC refund, zero allowance, zero active positions,
   zero claimable prizes, and restored pool accounting.

Wallet indices 2-4, external funding keys, draw, claim, deployment, contract or
token changes, administration, the 100th join, Base Mainnet, and blind write
retry were not available through this launcher and were not used.

## Verified public evidence

The bound journal contains eight confirmed operations and no pending,
ambiguous, failed, or manual-review operation. Public Base Sepolia receipts
have status `1`; their sender, destination, nonce, calldata, and expected event
agree with the journal and operator scope.

| Wallet | Action | Nonce | Block | Transaction hash |
| --- | --- | ---: | ---: | --- |
| 0 | faucet | 0 | 44319355 | `0x46fe97e7d5f05bf90ae2e425c18551fb4b2359ef8c43cff8d2cece2afcbf0d12` |
| 0 | approve | 1 | 44319357 | `0x0c0e2007d85aa93b29597665261554dfbc42fcf0ea72f64bd9a2a1cc56dc6a74` |
| 0 | join, position 5 | 2 | 44319359 | `0xdfbb3f3e7eb39fbdb7adfd23c0a5bc84b97e5e02e209cea7f22f42739cf12b2e` |
| 0 | withdraw, position 5 | 3 | 44319361 | `0x76934d3dc31388bf09726b31ca27a4edea5f674ac6c02a643f12ddce7aa97831` |
| 1 | faucet | 0 | 44319365 | `0xe90689de12e969b69cda8713a4442c99f009943c18b916f4d1e0b19753a902b6` |
| 1 | approve | 1 | 44319367 | `0x0f143537dc477334c630e0c2319c2792fe5609ddaf262cb80efdcf318f22e025` |
| 1 | join, position 6 | 2 | 44319369 | `0x67a326aa67da733eb458eb9d40565c1bc760b90f5e8b4ede96bc71ce44e126f4` |
| 1 | withdraw, position 6 | 3 | 44319371 | `0xfa44837ab6402f3a0a5501d6cdd6de766946f266b6c59b3395958815ca91ada7` |

Final public reads confirmed for both wallets: nonce `4/4`, 330 dUSDC, zero
allowance, zero active positions, active position ID zero, and zero claimable
prize. Pool 1 is `Open` with zero active positions, zero escrow, no lock time,
zero completed draws, and zero claims.

The post-pilot SHA-256 values are:

- checkpoint: `55097C7ED0DCD74185AEA900B7917E09A0113294E4933BA76C55A5828F06C707`;
- journal: `62AC7E111EE45BB310CD86A7BA07DCF715B401F9C4FA5848581E5C7C51C1F557`;
- manifest: `E2BA9BD7D88FAF61B016AED0F6312E8E735741B92C6667988401EACCA88C7B04`;
- encrypted wallet store: `9CBE4C2498E0223519E0D20FA288ADF51D4DB4D1DD5B4C222409895993D911B6`.

The manifest and encrypted wallet-store hashes match their pre-pilot values.
Checkpoint and journal changes are expected durable records of the eight
confirmed operations.

## Historical Stage A: manual ETH funding

The public pilot addresses are:

- wallet 0: `0xAF1b71E20c8c5A3eA133b57938da8dc62fE5a9b7`;
- wallet 1: `0x44016AaA384A5b52cE0FD86F49cF7Be817D75485`.

The 2026-07-18 read-only estimate used 75,630 gas for faucet, 46,713 gas for
approval, conservative budgets of 400,000 for join and 250,000 for withdrawal,
the then-current 11,000,000 wei gas price, and a 2x buffer. It produced a
dynamic requirement of 16,991,546,000,000 wei (about 0.000017 ETH) per wallet.

Send 0.00002 Base Sepolia ETH as the minimum operational amount plus 0.00003
ETH as a separate safety reserve to each wallet: 0.00005 ETH per wallet and
0.00010 ETH total. The launcher recalculates the requirement and stops before
the first write if the live buffered requirement is higher. Unused ETH remains
in each pilot wallet; the operator does not sweep or refund it.

In MetaMask, select Base Sepolia, use a dedicated disposable test funding
wallet, verify each full destination address independently, and make two manual
transfers of 0.00005 ETH. Wait for both receipts and confirm the balances in a
block explorer. Never provide the funding wallet seed phrase, private key, or
keystore to this repository, launcher, Codex, ChatGPT, or any report.

## Historical Stage B: guarded operator execution

The command used from the repository root was:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\packages\contracts\scripts\run-base-sepolia-pilot-2-write.ps1'
```

The launcher displays the immutable identity and scope, asks for both exact,
case-sensitive confirmations, then requests the existing wallet-store password
as a hidden PowerShell `SecureString`:

```text
CONFIRM POP33 BASE SEPOLIA PILOT 2
CONFIRM FAUCET APPROVE JOIN WITHDRAW FOR WALLETS 0 AND 1
```

The password is not a CLI argument, `.env` entry, shell-history item, or log
field. A child-only environment carries it to the operator and is discarded
after the child exits. The launcher accepts no funding-wallet key.

The encrypted store is a single authenticated AES-GCM envelope, so integrity
checking necessarily decrypts that envelope in memory. Only entries 0 and 1
are converted into connected signer objects; private keys for entries 2-4 are
never instantiated as signers, printed, journaled, or exposed to an operation.
Changing to independently decryptable per-wallet records would require a new
store format and is outside this narrowly scoped pilot.

## Journal, recovery, and checkpoint

The write coordinator is the existing Base Sepolia reversible smoke mechanism.
Before every operation it validates the chain, deployed bytecode, token linkage,
fixed parameters, pool state, wallet state, nonce, and buffered gas. It creates
a durable journal entry, simulates with `eth_estimateGas`, reserves the pending
nonce, signs with the selected pilot wallet, records the hash,
waits for the receipt, verifies calldata and event evidence, and then checks
semantic post-state.

Both wallets share the existing bound version 2 journal, but each coordinator
sees only its own operations. A global guard rejects any operation for another
wallet, pool, chain, contract, token, or action, and rejects duplicates. A
confirmed operation is revalidated and not rebroadcast. A prepared operation
has no reserved nonce or hash and may continue. A ready-to-broadcast,
broadcast, pending, failed, replaced, cancelled, timeout, nonce mismatch, or
manual-review state stops progression unless the existing recovery logic can
prove a confirmed receipt and matching semantic result. Ambiguous broadcast
errors are marked `requires_manual_review`; they are never blindly retried.

After each wallet completes withdrawal and final verification, its public
receipt evidence and final balances are written atomically to the bound
checkpoint. Wallet store and manifest SHA-256 hashes must remain unchanged;
checkpoint and journal are expected to change. Preserve all four artifacts as
one recovery unit.

## Observed success messages

For each wallet the runner prints its index, public address, live buffered gas
requirement, `COMPLETE: no active position, allowance 0, claimable 0`, and the
four public transaction hashes. The final line is:

```text
PILOT COMPLETE: both wallets are withdrawn and checkpoint/journal are consistent.
```

The launcher confirmed unchanged wallet-store and manifest hashes. The observed
final chain state is 330 dUSDC, allowance 0, no active position, no claimable
prize, pool 1 still Open, and pool active count and escrow restored to their
pre-wallet values. ETH was reduced only by gas.

## Stop immediately

Stop and do not rerun blindly if any address, chain, contract, token, pool,
confirmation, password, artifact binding, checkpoint, or wallet order differs;
if pool 1 is not Open or enters the safety margin; if ETH is below the live
buffer; if balances, allowance, cooldown, position, participant count, escrow,
or claimable state is unexpected; or if the runner reports a revert, timeout,
pending transaction, replacement, cancellation, nonce mismatch, RPC
disagreement, ambiguous broadcast, or manual review. Preserve the journal and
checkpoint and inspect the public transaction hash and on-chain state before
any recovery decision.
