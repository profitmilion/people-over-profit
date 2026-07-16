import type { HDNodeWallet, Provider } from "ethers";
import { Wallet } from "ethers";

export type OperatorWallet = HDNodeWallet | Wallet;

export interface OperatorWalletProvider {
  readonly kind: "local-ephemeral" | "external-encrypted";
  readonly supportsProcessRestart: boolean;
  listWallets(): readonly OperatorWallet[];
  findWallet(address: string): OperatorWallet | undefined;
}

export interface InteractivePasswordReader {
  readPassword(prompt: string): Promise<string>;
}

export interface FutureEncryptedWalletSource {
  readonly kind: "encrypted-keystore-directory" | "encrypted-seed-file";
  readonly pathOutsideRepository: string;
  readonly deterministicTestnetDerivation: boolean;
  readonly passwordReader: InteractivePasswordReader;
}

export class EphemeralLocalWalletProvider implements OperatorWalletProvider {
  readonly kind = "local-ephemeral" as const;
  readonly supportsProcessRestart = false;
  private readonly walletsByAddress: Map<string, OperatorWallet>;

  private constructor(private readonly wallets: readonly HDNodeWallet[]) {
    this.walletsByAddress = new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet]),
    );
  }

  static create(count: number, provider: Provider): EphemeralLocalWalletProvider {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error("Local wallet count must be a positive safe integer.");
    }
    const wallets = Array.from({ length: count }, () =>
      Wallet.createRandom().connect(provider),
    );
    return new EphemeralLocalWalletProvider(wallets);
  }

  listWallets(): readonly OperatorWallet[] {
    return this.wallets;
  }

  findWallet(address: string): OperatorWallet | undefined {
    return this.walletsByAddress.get(address.toLowerCase());
  }
}
