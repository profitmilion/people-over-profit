import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_MANIFEST_FILE_NAME,
  WALLET_STORE_V2_STORE_FILE_NAME,
  WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME,
} from "../scripts/operator/guarded-checkpoint-20-wallet-store-v2.js";
import {
  PowerShellWindowsAclAdapter,
  WindowsWalletStoreV2ProductionFileSecurity,
} from "../scripts/operator/wallet-store-v2-windows-security.js";

describe("Wallet Store v2 real Windows ACL integration", function () {
  this.timeout(60_000);

  it("protects and verifies only a disposable checkpoint-shaped temporary tree", async function () {
    if (process.platform !== "win32") this.skip();
    const temporaryParent = await mkdtemp(join(tmpdir(), "pop33-wallet-store-v2-acl-integration-"));
    try {
      const checkpointRoot = resolve(temporaryParent, "checkpoint-20");
      const activeRoot = resolve(checkpointRoot, "active");
      const identityRoot = resolve(checkpointRoot, "identity");
      const common = {
        localAppDataDirectory: temporaryParent,
        workspaceDirectory: resolve(temporaryParent, "unrelated-workspace"),
        fixturePolicyCheckpointRoot: checkpointRoot,
        fixtureAuthorization: WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
      };
      const activeSecurity = new WindowsWalletStoreV2ProductionFileSecurity({
        ...common,
        rootDirectory: activeRoot,
        adapter: new PowerShellWindowsAclAdapter(),
      });
      const bundleDirectory = resolve(activeRoot, `integration${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`);
      await activeSecurity.assertBeforeCreate(bundleDirectory);
      await mkdir(bundleDirectory, { recursive: false });
      await writeFile(resolve(bundleDirectory, WALLET_STORE_V2_STORE_FILE_NAME), "{}\n", "utf8");
      await writeFile(resolve(bundleDirectory, WALLET_STORE_V2_MANIFEST_FILE_NAME), "{}\n", "utf8");
      await activeSecurity.assertAfterCommit(bundleDirectory);
      await activeSecurity.assertBeforeOpen(bundleDirectory);

      const identitySecurity = new WindowsWalletStoreV2ProductionFileSecurity({
        ...common,
        rootDirectory: identityRoot,
        adapter: new PowerShellWindowsAclAdapter(),
      });
      for (const [fileName, kind] of [
        [WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME, "trusted-identity"],
        [WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME, "ceremony-state"],
      ] as const) {
        const path = resolve(identityRoot, fileName);
        await identitySecurity.assertPublicFileBeforeCreate(path, kind);
        await writeFile(path, "{}\n", "utf8");
        await identitySecurity.assertPublicFileAfterCommit(path, kind);
        await identitySecurity.assertPublicFileBeforeOpen(path, kind);
      }
      const realProductionRoot = process.env.LOCALAPPDATA
        ? resolve(process.env.LOCALAPPDATA, "POP33", "operator", "checkpoint-20")
        : "";
      assert.notEqual(checkpointRoot.toLowerCase(), realProductionRoot.toLowerCase());
    } finally {
      await rm(temporaryParent, { recursive: true, force: true });
    }
  });
});
