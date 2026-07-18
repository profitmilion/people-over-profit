# Base Sepolia two-wallet write pilot runbook

## Current authorization boundary

This runbook prepares one reversible testnet pilot for exactly wallet indices
0 and 1 from the existing five-wallet set, chain 84532, the recorded dUSDC and
POP33 Demo V1 contracts, and pool 1. Piotr has not funded these wallets or run
the launcher. No transaction from the new five-wallet set has been signed or
broadcast.

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
retry are not available through this launcher.

## Stage A: manual ETH funding

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

## Stage B: guarded operator execution

From the repository root, Piotr later runs exactly:

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

## Expected success messages

For each wallet the runner prints its index, public address, live buffered gas
requirement, `COMPLETE: no active position, allowance 0, claimable 0`, and the
four public transaction hashes. The final line is:

```text
PILOT COMPLETE: both wallets are withdrawn and checkpoint/journal are consistent.
```

The launcher then confirms unchanged wallet-store and manifest hashes. Expected
final chain state is 330 dUSDC, allowance 0, no active position, no claimable
prize, pool 1 still Open, and pool active count and escrow restored to their
pre-wallet values. ETH is reduced only by gas.

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
