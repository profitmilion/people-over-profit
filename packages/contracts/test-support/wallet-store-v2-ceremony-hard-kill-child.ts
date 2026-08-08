import { Buffer } from "node:buffer";
import { resolve } from "node:path";

import {
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  InjectedTestPasswordProvider,
  NodeCSPRNGProductionWalletGenerator,
  buildWalletStoreV2ProductionFormatFixtureBundle,
  type WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
} from "../scripts/operator/guarded-checkpoint-20-wallet-store-v2.js";
import {
  runWalletStoreV2ProductionFormatFixtureCeremony,
  walletStoreV2CeremonyPaths,
  type WalletStoreV2CeremonyFaultBoundary,
} from "../scripts/operator/wallet-store-v2-ceremony.js";

const CREATED_AT = "2026-08-08T18:00:00.000Z";
const CEREMONY_ID = "60606060-6060-4060-8060-606060606060";
const PASSWORD = Buffer.from("fixture-hard-kill-password", "utf8");

class TemporaryFixtureSecurity implements WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity {
  readonly artifactClass = "production-format-fixture" as const;
  async assertBeforeCreate(): Promise<void> {}
  async assertAfterCommit(): Promise<void> {}
  async assertBeforeOpen(): Promise<void> {}
  async assertPublicFileBeforeCreate(): Promise<void> {}
  async assertPublicFileAfterCommit(): Promise<void> {}
  async assertPublicFileBeforeOpen(): Promise<void> {}
}

function generator(): NodeCSPRNGProductionWalletGenerator {
  let index = 0;
  return NodeCSPRNGProductionWalletGenerator.createForInjectedTests({
    authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
    nextBytes: () => {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32BE(index + 1, 28);
      index += 1;
      return bytes;
    },
  });
}

const root = process.argv[2];
const selectedBoundary = process.argv[3] as WalletStoreV2CeremonyFaultBoundary | undefined;
if (!root || !selectedBoundary) throw new Error("Hard-kill fixture requires root and boundary arguments.");

const security = new TemporaryFixtureSecurity();
await runWalletStoreV2ProductionFormatFixtureCeremony({
  authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  dependencies: {
    artifactClass: "production-format-fixture",
    paths: walletStoreV2CeremonyPaths(resolve(root, "checkpoint-20")),
    activeSecurity: security,
    backupSecurity: security,
    identitySecurity: security,
    buildBundle: async (createdAt, ceremonyId) => {
      const password = new InjectedTestPasswordProvider(PASSWORD, WALLET_STORE_V2_FIXTURE_AUTHORIZATION);
      try {
        return await buildWalletStoreV2ProductionFormatFixtureBundle({
          passwordProvider: password,
          walletGenerator: generator(),
          ceremonyId,
          createdAt,
          authorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
        });
      } finally {
        password.destroy();
      }
    },
    createCeremonyId: () => CEREMONY_ID,
    now: () => CREATED_AT,
    fault: async (boundary) => {
      if (boundary !== selectedBoundary) return;
      process.send?.({ boundary });
      await new Promise<never>(() => undefined);
    },
  },
});
