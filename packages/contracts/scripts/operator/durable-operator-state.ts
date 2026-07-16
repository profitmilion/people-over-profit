import type { Provider } from "ethers";

import {
  openEncryptedWalletProviderFromEnvironment,
  type EncryptedWalletProvider,
} from "./encrypted-wallet-store.js";
import {
  JsonTransactionJournal,
  readJournalPathFromEnvironment,
  type JournalIdentity,
} from "./transaction-journal.js";
import type { InteractivePasswordReader } from "./wallet-provider.js";

export async function openDurableOperatorState(input: {
  env: NodeJS.ProcessEnv;
  passwordReader: InteractivePasswordReader;
  walletCount: number;
  provider: Provider;
  journalIdentity: JournalIdentity;
}): Promise<{
  wallets: EncryptedWalletProvider;
  journal: JsonTransactionJournal;
}> {
  const wallets = await openEncryptedWalletProviderFromEnvironment({
    env: input.env,
    passwordReader: input.passwordReader,
    walletCount: input.walletCount,
    provider: input.provider,
  });
  const journal = await JsonTransactionJournal.open(
    readJournalPathFromEnvironment(input.env),
    input.journalIdentity,
  );
  return { wallets, journal };
}
