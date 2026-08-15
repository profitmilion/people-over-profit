# POP33 Demo V1 — first public tester guide

## Dla Piotra

Celem tego testu jest bezpieczne sprawdzenie na telefonie, czy publiczne POP33
Demo V1 działa z osobnym portfelem testowym MetaMask na sieci Base Sepolia.
Test obejmuje faucet testowego dUSDC, dokładne zatwierdzenie 33 dUSDC, dołączenie
do otwartej puli, opcjonalną wypłatę z nadal otwartej puli oraz sprawdzenie
archiwum. Nie używaj prawdziwych środków ani głównego portfela.

## Test links and reviewed addresses

- Landing:
  <https://pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app>
- Demo V1:
  <https://pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app/#/demo-v1>
- Demo V1 archive:
  <https://pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app/#/archive-v1>
- POP33 Demo USD (`dUSDC`) token:
  `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`
- POP33 Basic V1 contract and approval spender:
  `0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98`

These links are the current Pilot 10 **testing Preview**, not Vercel
Production. The intended future Production host is
`https://pop33-demo.vercel.app`, but it has not been promoted or approved by
this checkpoint.

Compare the complete addresses, not only the first and last characters.

## 1. Safety first

- Use **Base Sepolia only**.
- Do not use Base Mainnet or Ethereum Mainnet.
- Use a separate test wallet account with no real assets.
- Do not send real ETH, USDC, or any other real asset to this test wallet.
- `dUSDC` has no monetary value. It is POP33 Demo USD and is not official
  Circle USDC.
- Never enter a Secret Recovery Phrase, seed phrase, or private key into POP33,
  a faucet, a block explorer, or any other website.
- Never send a Secret Recovery Phrase or private key to another person.
- Read every MetaMask request before approving it. Reject anything you do not
  understand.
- Connecting the wallet is not a transaction. Faucet, approval, join, and
  withdrawal are separate on-chain transactions and each costs a small amount
  of Base Sepolia test ETH for gas.

## 2. Prepare MetaMask on the phone

1. Install MetaMask Mobile only from the official Apple App Store or Google
   Play listing reached from <https://metamask.io/download/>.
2. Open MetaMask Mobile.
3. Create or select a separate account used only for this test.
4. Confirm that this account contains no real assets.
5. In MetaMask, tap the **Explore** tab.
6. Tap the browser icon or use the search/address field in Explore.
7. Paste the full Demo V1 link:
   <https://pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app/#/demo-v1>
8. In **Przygotowanie do Demo**, tap **Connect wallet**.
9. In MetaMask, select and connect only the separate test account.
10. Return to POP33 and compare the shortened value under **Wallet** with the
    selected account. If in doubt, open the account in MetaMask and compare the
    full public address.

The preparation panel now shows one next action at a time. If the phone browser
does not expose a compatible wallet, reopen the same link inside MetaMask
Explore or another compatible wallet's built-in browser. WalletConnect is not
part of this Demo stage. If a request is rejected, the page says so and waits
for the tester to retry manually; it does not submit anything automatically.

The official MetaMask mobile browser is inside the **Explore** tab. Do not open
the test in an unknown in-app browser, and do not type a seed phrase into any
website.

## 3. Use Base Sepolia

The reviewed network parameters are:

| Field | Value |
| --- | --- |
| Network name | `Base Sepolia` |
| RPC URL | `https://sepolia.base.org` |
| Chain ID | `84532` |
| Currency symbol | `ETH` |
| Block explorer | `https://sepolia.basescan.org` |

The POP33 app is configured only for Base Sepolia. If the connected wallet is
on another network, the page shows:

> Wrong network. Demo V1 requires Base Sepolia, chain ID 84532.

First tap **Switch to Base Sepolia** and review the MetaMask request. MetaMask may ask
to switch to Base Sepolia or add it before switching.

Only if that automatic request is unavailable:

1. Open the network selector in MetaMask.
2. Open the custom network option.
3. Add the exact parameters from the table above.
4. Save the network and select **Base Sepolia**.
5. Return to POP33 and confirm that the page header says
   **Base Sepolia · Demo V1**.

Stop if MetaMask shows chain ID `8453`, Base Mainnet, Ethereum Mainnet, or any
chain ID other than `84532`.

## 4. Get a small amount of Base Sepolia test ETH

Base Sepolia test ETH is needed only for gas. It has no monetary value. Do not
buy real ETH for this test.

Use the current official Base faucet list as the primary source:

- <https://docs.base.org/base-chain/network-information/network-faucets>

Choose a Base Sepolia ETH provider from that list. POP33 does not require one
specific third-party faucet.

In the faucet:

1. Select **Base Sepolia** and test ETH.
2. Use only the public address of the separate test account.
3. Request a small testnet amount.
4. Wait until MetaMask shows a Base Sepolia ETH balance. The preparation panel
   recommends at least `0.00005 ETH` before enabling the next transaction.
5. Return to POP33 and check the **Base Sepolia ETH** field.

Never enter a seed phrase or private key. If the official faucet is unavailable
or asks for anything unexpected, stop. Do not use a faucet found through an
advertisement or a random search result.

The POP33 **Get test dUSDC** button is a different faucet. It supplies valueless
POP33 test dUSDC, not gas ETH.

## 5. Main smoke test

Before starting, keep a note where you can safely record public transaction
hashes. Do not record a seed phrase, private key, wallet password, or recovery
backup.

### Open and connect

- [ ] Open the landing page and confirm that it says
      **POP33 Demo V1 · Base Sepolia**.
- [ ] Tap **POP IT - open Demo V1**.
- [ ] Confirm that the Demo page says **Base Sepolia · Demo V1** and
      **POP33 Basic V1**.
- [ ] Tap **Connect wallet** and connect only the separate test account.
- [ ] Confirm the expected wallet account and Base Sepolia chain ID `84532`.
- [ ] Follow the single main action in **Przygotowanie do Demo**.
- [ ] Confirm that its checklist marks wallet and Base Sepolia as ready.
- [ ] Confirm that **Base Sepolia ETH** is at least the displayed recommended
      minimum.
- [ ] Confirm that the page does not show a configuration error, runtime
      identity error, or unavailable Base Sepolia reads.

### Get test dUSDC

- [ ] In **Przygotowanie do Demo**, continue only when **Get dUSDC** is the
      main action. If the cooldown is active, wait for its displayed end time.
- [ ] Note the current **dUSDC balance**.
- [ ] Tap **Get test dUSDC**.
- [ ] In MetaMask, confirm that the transaction is on Base Sepolia and goes to
      the reviewed dUSDC token address:
      `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`.
- [ ] Approve the faucet transaction and wait. Do not tap the button again.
- [ ] Wait for **Faucet drip: Confirmed and verified** and the message
      `Faucet confirmed: exact 330 dUSDC balance increase and cooldown verified.`
- [ ] Save the public transaction hash using
      **View transaction on BaseScan** or MetaMask Activity.
- [ ] Tap **Refresh on-chain reads** if the values did not refresh
      automatically.
- [ ] Note the new **dUSDC balance**. The expected increase is exactly
      330 dUSDC.

The page also shows **Allowance**. Before the first approval it should normally
be `0 dUSDC`.

### Understand the transaction status

For a normal transaction, the blue status box progresses through:

1. **Waiting for wallet signature**;
2. **Submitted**;
3. **Waiting for receipt**;
4. **Verifying on-chain state**;
5. **Confirmed and verified**.

The box also shows a plain-language message and, after submission, a
**View transaction on BaseScan** link.

**Rejected** or **Cancelled** means that the wallet request was not completed.
**Insufficient dUSDC** means the wallet needs at least 33 dUSDC for join.
**Insufficient Base Sepolia ETH** means the wallet needs more test ETH for gas.
**Another transaction flow is active** means the current operation must finish
before another action can start. Do not repeatedly tap an action button.

### Exact approval and join

The page intentionally presents two separate steps:

1. **Approve 33 dUSDC** creates only the exact approval transaction;
2. after its receipt and a fresh exact allowance read, the main action changes
   to **Join pool**.

The app never sends the join before observing the exact allowance on-chain.

- [ ] Confirm that **dUSDC balance** is at least `33 dUSDC`.
- [ ] Confirm the displayed **Entry** is `33 dUSDC`.
- [ ] Confirm **Approval required: yes** for a wallet with zero allowance.
      If a fresh test account unexpectedly shows `no` or a non-zero allowance,
      stop and record it before continuing.
- [ ] When it is the main action, tap **Approve 33 dUSDC** once.
- [ ] In the first MetaMask request, verify all of the following:
  - network: Base Sepolia, chain ID `84532`;
  - token: `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`;
  - spender: `0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98`;
  - amount or spending cap: exactly `33 dUSDC`, not unlimited.
- [ ] Approve only if every value is correct.
- [ ] Watch for **Approve exactly 33 dUSDC: Confirmed and verified**.
- [ ] Save the approval hash from MetaMask Activity or
      **View transaction on BaseScan**.
- [ ] Return to the preparation panel and tap **Join pool** only after it
      becomes the single main action.
- [ ] When MetaMask opens the join request, confirm it is a separate Base
      Sepolia transaction to the reviewed POP33 Basic V1 contract:
      `0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98`.
- [ ] Approve the join transaction only after the approval is confirmed.
- [ ] Do not tap the main action again while the status says
      waiting, submitted, confirming, or verifying.
- [ ] Wait for **Join pool: Confirmed and verified**.
- [ ] Read the success message. It should identify a position and pool and say
      that exact payment, the active position, and escrow were verified.
- [ ] Save the join hash using **View transaction on BaseScan** or MetaMask
      Activity, then open it in BaseScan.
- [ ] Tap **Refresh on-chain reads** if needed.
- [ ] Confirm:
  - **dUSDC balance** decreased by exactly 33 dUSDC from the pre-join balance;
  - **Allowance** returned to `0 dUSDC`;
  - **Active positions** increased by one;
  - **My active positions** shows `Position #... · pool #...`;
  - the pool and escrow values changed consistently.

The status box shows the current transaction hash, not a permanent history of
all previous hashes. Save each hash in the test report or recover it from
MetaMask Activity before clearing the status or reloading the page. Use
**Clear transaction status** only after recording the result.

### Withdraw only from an Open pool

Withdrawal is allowed only when the position is active and its pool status is
**Open**. The button is **Withdraw from open pool**.

Do not withdraw if:

- the pool is **Locked**, **Drawing**, or **Finished**;
- the button is disabled;
- the position is not listed under **My active positions**;
- POP33 says participant withdrawal is no longer available.

- [ ] Confirm the relevant pool is **Open**.
- [ ] Confirm the position is listed under **My active positions**.
- [ ] Tap **Withdraw from open pool** for that exact position.
- [ ] Review and approve the Base Sepolia transaction in MetaMask.
- [ ] Wait for **Withdraw position #...: Confirmed and verified**.
- [ ] Check for the message:
      `Withdrawal confirmed: position #... is inactive and the exact 33 dUSDC refund and pool escrow were verified.`
- [ ] Save and open the withdrawal hash using
      **View transaction on BaseScan** or MetaMask Activity.
- [ ] Refresh reads if needed.
- [ ] Confirm:
  - the exact 33 dUSDC refund was added to **dUSDC balance**;
  - **Active positions** decreased by one;
  - the withdrawn position is no longer listed under
    **My active positions**;
  - the pool and escrow values changed consistently.

### Optional second join

Do this only if faucet, approval, first join, and withdrawal all completed and
verified without an unresolved warning or error.

- [ ] Confirm **Allowance** is `0 dUSDC`, the wallet has at least `33 dUSDC`,
      and Base Sepolia ETH is still greater than zero.
- [ ] Follow **Approve 33 dUSDC**, wait for confirmation, and then use the
      separate **Join pool** action.
- [ ] Repeat the exact 33 dUSDC approval checks.
- [ ] Approve the separate join request only after the approval is confirmed.
- [ ] Save the second approval and second join hashes.
- [ ] Confirm the new active position appears in **My active positions**.
- [ ] Do not withdraw this second position unless Piotr explicitly decides to
      extend the test and the position is still in an **Open** pool.

### Check the archive

- [ ] Open **Demo V1 archive** from the Demo page, or use:
      <https://pop33-demo-git-codex-pop33-farcas-b58381-profitmilions-projects.vercel.app/#/archive-v1>.
- [ ] Confirm the page title is **Demo V1 archive**.
- [ ] Confirm it says **Base Sepolia test data only**.
- [ ] Confirm pools and their round rows load without `RPC read failed`.
- [ ] Optionally tap **Inspect contract** to open the reviewed contract in
      BaseScan.

The archive is getter-based. It shows pool and round state, but it does not
invent or retain historical transaction hashes.

## 6. Stop conditions

Stop immediately and do not approve another request if any of these happens:

- MetaMask shows Base Mainnet, Ethereum Mainnet, chain ID `8453`, or any chain
  other than Base Sepolia `84532`.
- POP33 or another page asks for real funds.
- An approval is not exactly `33 dUSDC` or asks for an unlimited amount.
- The approval token is not
  `0xA7FA084b34c888061757d4b5FBb08a7B53fee786`.
- The approval spender or join contract is not
  `0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98`.
- Any website or person asks for a seed phrase, Secret Recovery Phrase, or
  private key.
- A MetaMask request is unclear or does not match the action you just started.
- The app shows a configuration error, runtime identity error, unavailable
  Base Sepolia reads, or another critical error.
- The status says **Exact allowance not observed**,
  **Existing allowance is too high**, **Unknown state — manual review
  required**, **Receipt found — state verification failed**, **Replaced —
  manual review required**, or **Reverted or failed**.
- A receipt is not observed within 180 seconds. Do not retry automatically;
  save the hash, inspect BaseScan, and report the result.
- The pool is not **Open**, the position is inactive, or
  **Withdraw from open pool** is disabled.
- The pool reaches 10/10. The 10th join locks the Pilot 10 pool and withdrawal
  is no longer available.
- The visible balance, allowance, active position, refund, or escrow change
  does not match the expected result.

If MetaMask rejects or cancels a request, record that result. Do not keep
pressing the action button.

## 7. Test report

Copy and complete this template:

```text
Date and local time:
Phone model:
Operating system and version:
MetaMask Mobile version:

Public application URL:
Test wallet public address:
Detected network name:
Detected chain ID:

Connect result: PASS / FAIL
Base Sepolia test ETH available:
dUSDC faucet result:
Faucet transaction hash:
dUSDC balance before faucet:
dUSDC balance after faucet:

Approval result:
Approval transaction hash:
Observed token address:
Observed spender address:
Observed approval amount:

First join result:
First join transaction hash:
Position ID:
Pool ID and status:
Active positions after join:
dUSDC balance after join:
Allowance after join:

Withdrawal attempted: YES / NO
Reason if not attempted:
Withdrawal transaction hash, if attempted:
Refund result:
dUSDC balance after withdrawal:
Active position removed: YES / NO

Second approval hash, if performed:
Second join hash, if performed:
Second position ID, if performed:

Archive result:
Errors or unexpected messages:
Screenshots taken:

Overall result: PASS / PARTIAL / FAIL
```

Screenshots may contain public wallet addresses and public transaction hashes.
They must never contain a seed phrase, Secret Recovery Phrase, private key,
wallet password, QR recovery backup, or other private wallet material.
