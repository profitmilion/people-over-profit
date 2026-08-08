import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { OPERATOR_WORKSPACE_ROOT } from "./checkpoint.js";
import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_MANIFEST_FILE_NAME,
  WALLET_STORE_V2_STORE_FILE_NAME,
  WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME,
  type WalletStoreV2CeremonyFileSecurity,
  type WalletStoreV2CeremonyPublicFileKind,
} from "./guarded-checkpoint-20-wallet-store-v2.js";

const execFileAsync = promisify(execFile);
const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";

export interface WindowsAclEntry {
  sid: string;
  type: "Allow" | "Deny";
  rights: string;
}

export interface WindowsAclSnapshot {
  inheritanceProtected: boolean;
  entries: readonly WindowsAclEntry[];
}

export interface WindowsAclAdapter {
  readonly adapterClass: "windows-acl";
  currentUserSid(): Promise<string>;
  protectDirectory(directory: string, allowedSids: readonly string[]): Promise<void>;
  inspect(path: string): Promise<WindowsAclSnapshot>;
  isReparsePoint(path: string): Promise<boolean>;
  canonicalPath(path: string): Promise<string>;
}

function normalizedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(candidate: string, parent: string): boolean {
  const child = normalizedPath(candidate);
  const root = normalizedPath(parent);
  return child === root || child.startsWith(`${root}${sep}`);
}

function requireAbsolute(value: string, label: string): string {
  if (value.split(/[\\/]+/u).some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${label} must not contain raw dot segments.`);
  }
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  return resolve(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class PowerShellWindowsAclAdapter implements WindowsAclAdapter {
  readonly adapterClass = "windows-acl" as const;

  constructor() {
    if (process.platform !== "win32") throw new Error("Windows ACL adapter requires Windows.");
  }

  async currentUserSid(): Promise<string> {
    const { stdout } = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      windowsHide: true,
      timeout: 10_000,
    });
    const match = stdout.match(/"(S-1-[0-9-]+)"\s*$/m);
    if (!match) throw new Error("Unable to determine the current Windows user SID.");
    return match[1];
  }

  async protectDirectory(directory: string, allowedSids: readonly string[]): Promise<void> {
    const grants = allowedSids.map((sid) => `*${sid}:(OI)(CI)F`);
    await execFileAsync("icacls.exe", [directory, "/inheritance:r", "/grant:r", ...grants], {
      windowsHide: true,
      timeout: 15_000,
    });
  }

  async inspect(path: string): Promise<WindowsAclSnapshot> {
    const script = [
      "$target = [Environment]::GetEnvironmentVariable('POP33_WALLET_STORE_V2_ACL_TARGET')",
      "$acl = Get-Acl -LiteralPath $target",
      "$entries = @($acl.Access | ForEach-Object {",
      "  $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value",
      "  [pscustomobject]@{ sid=$sid; type=$_.AccessControlType.ToString(); rights=$_.FileSystemRights.ToString() }",
      "})",
      "[pscustomobject]@{ inheritanceProtected=$acl.AreAccessRulesProtected; entries=$entries } | ConvertTo-Json -Compress -Depth 4",
    ].join("; ");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 15_000,
        env: { ...process.env, POP33_WALLET_STORE_V2_ACL_TARGET: path },
      },
    );
    const parsed = JSON.parse(stdout) as { inheritanceProtected?: unknown; entries?: unknown };
    if (typeof parsed.inheritanceProtected !== "boolean" || !Array.isArray(parsed.entries)) {
      throw new Error("Windows ACL inspection returned an invalid result.");
    }
    const entries = parsed.entries.map((entry) => {
      const candidate = entry as Partial<WindowsAclEntry>;
      if (
        typeof candidate.sid !== "string" ||
        (candidate.type !== "Allow" && candidate.type !== "Deny") ||
        typeof candidate.rights !== "string"
      ) throw new Error("Windows ACL inspection returned an invalid entry.");
      return { sid: candidate.sid, type: candidate.type, rights: candidate.rights };
    });
    return { inheritanceProtected: parsed.inheritanceProtected, entries };
  }

  async isReparsePoint(path: string): Promise<boolean> {
    const script = [
      "$target = [Environment]::GetEnvironmentVariable('POP33_WALLET_STORE_V2_ACL_TARGET')",
      "$item = Get-Item -LiteralPath $target -Force",
      "$isReparse = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)",
      "$isReparse.ToString().ToLowerInvariant()",
    ].join("; ");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 10_000,
        env: { ...process.env, POP33_WALLET_STORE_V2_ACL_TARGET: path },
      },
    );
    const result = stdout.trim();
    if (result !== "true" && result !== "false") {
      throw new Error("Windows reparse-point inspection returned an invalid result.");
    }
    return result === "true";
  }

  canonicalPath(path: string): Promise<string> {
    return realpath(path);
  }
}

export interface WindowsProductionPathPolicyInput {
  rootDirectory: string;
  localAppDataDirectory: string;
  workspaceDirectory?: string;
  synchronizedDirectories?: readonly string[];
  adapter: WindowsAclAdapter;
  fixturePolicyCheckpointRoot?: string;
  fixtureAuthorization?: string;
}

export class WindowsWalletStoreV2ProductionFileSecurity implements WalletStoreV2CeremonyFileSecurity {
  readonly artifactClass = "production" as const;
  readonly #rootDirectory: string;
  readonly #localAppDataDirectory: string;
  readonly #workspaceDirectory: string;
  readonly #synchronizedDirectories: readonly string[];
  readonly #adapter: WindowsAclAdapter;
  #allowedSids: readonly string[] | null = null;

  constructor(input: WindowsProductionPathPolicyInput) {
    this.#rootDirectory = requireAbsolute(input.rootDirectory, "Production Wallet Store v2 root");
    this.#localAppDataDirectory = requireAbsolute(input.localAppDataDirectory, "LOCALAPPDATA root");
    this.#workspaceDirectory = requireAbsolute(
      input.workspaceDirectory ?? OPERATOR_WORKSPACE_ROOT,
      "Workspace root",
    );
    this.#synchronizedDirectories = (input.synchronizedDirectories ?? []).map((path) =>
      requireAbsolute(path, "Synchronized directory"));
    this.#adapter = input.adapter;
    const policyCheckpointRoot = input.fixturePolicyCheckpointRoot === undefined
      ? resolve(this.#localAppDataDirectory, "POP33", "operator", "checkpoint-20")
      : requireAbsolute(input.fixturePolicyCheckpointRoot, "Fixture checkpoint root");
    if (
      input.fixturePolicyCheckpointRoot !== undefined &&
      input.fixtureAuthorization !== WALLET_STORE_V2_FIXTURE_AUTHORIZATION
    ) {
      throw new Error("Fixture checkpoint root requires test-only authorization.");
    }
    const allowedRoots = [
      policyCheckpointRoot,
      resolve(policyCheckpointRoot, "active"),
      resolve(policyCheckpointRoot, "backup"),
      resolve(policyCheckpointRoot, "identity"),
    ].map(normalizedPath);
    if (isInside(this.#rootDirectory, this.#workspaceDirectory)) {
      throw new Error("Production Wallet Store v2 root must be outside the workspace.");
    }
    if (this.#synchronizedDirectories.some((path) => isInside(this.#rootDirectory, path))) {
      throw new Error("Production Wallet Store v2 root must not be inside OneDrive or another synchronized path.");
    }
    if (!allowedRoots.includes(normalizedPath(this.#rootDirectory))) {
      throw new Error(
        "Production Wallet Store v2 root must be the checkpoint-20 root or an allowlisted active, backup, or identity child.",
      );
    }
  }

  async #requiredSids(): Promise<readonly string[]> {
    if (!this.#allowedSids) {
      this.#allowedSids = [await this.#adapter.currentUserSid(), SYSTEM_SID, ADMINISTRATORS_SID];
    }
    return this.#allowedSids;
  }

  async #assertNoReparsePoints(path: string): Promise<void> {
    const absolute = resolve(path);
    const root = parse(absolute).root;
    const segments = relative(root, absolute).split(sep).filter(Boolean);
    let current = root;
    for (const segment of segments) {
      current = resolve(current, segment);
      if (!(await pathExists(current))) break;
      if (await this.#adapter.isReparsePoint(current)) {
        throw new Error("Production Wallet Store v2 path crosses a reparse point.");
      }
    }
  }

  async #assertAcl(path: string, requireProtected: boolean): Promise<void> {
    const allowed = new Set((await this.#requiredSids()).map((sid) => sid.toUpperCase()));
    const snapshot = await this.#adapter.inspect(path);
    if (requireProtected && !snapshot.inheritanceProtected) {
      throw new Error("Production Wallet Store v2 ACL inheritance is not disabled.");
    }
    if (snapshot.entries.some((entry) => entry.type !== "Allow" || !allowed.has(entry.sid.toUpperCase()))) {
      throw new Error("Production Wallet Store v2 ACL grants access to an unsupported principal.");
    }
    for (const sid of allowed) {
      if (!snapshot.entries.some((entry) => entry.sid.toUpperCase() === sid && /FullControl/i.test(entry.rights))) {
        throw new Error("Production Wallet Store v2 ACL is missing a required full-control principal.");
      }
    }
  }

  async #assertBundlePath(directory: string): Promise<string> {
    const absolute = requireAbsolute(directory, "Production Wallet Store v2 bundle directory");
    if (!absolute.toLowerCase().endsWith(WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX)) {
      throw new Error("Production Wallet Store v2 bundle directory suffix is invalid.");
    }
    if (!isInside(absolute, this.#rootDirectory) || absolute === this.#rootDirectory) {
      throw new Error("Production Wallet Store v2 bundle must be a child of the protected root.");
    }
    if (isInside(absolute, this.#workspaceDirectory)) {
      throw new Error("Production Wallet Store v2 bundle must be outside the workspace.");
    }
    if (this.#synchronizedDirectories.some((path) => isInside(absolute, path))) {
      throw new Error("Production Wallet Store v2 bundle must not be synchronized.");
    }
    await this.#assertNoReparsePoints(absolute);
    return absolute;
  }

  #assertPublicFilePath(path: string, kind: WalletStoreV2CeremonyPublicFileKind): string {
    const absolute = requireAbsolute(path, "Wallet Store v2 ceremony file");
    const expectedName = kind === "trusted-identity"
      ? WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME
      : kind === "ceremony-state"
        ? WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME
        : WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME;
    if (normalizedPath(absolute) !== normalizedPath(resolve(this.#rootDirectory, expectedName))) {
      throw new Error("Wallet Store v2 ceremony file path is not allowlisted.");
    }
    return absolute;
  }

  async #prepareProtectedRoot(): Promise<void> {
    await this.#assertNoReparsePoints(this.#rootDirectory);
    await mkdir(this.#rootDirectory, { recursive: true });
    const canonical = await this.#adapter.canonicalPath(this.#rootDirectory);
    if (normalizedPath(canonical) !== normalizedPath(this.#rootDirectory)) {
      throw new Error("Production Wallet Store v2 root canonical path mismatch.");
    }
    await this.#adapter.protectDirectory(this.#rootDirectory, await this.#requiredSids());
    await this.#assertAcl(this.#rootDirectory, true);
  }

  async assertBeforeCreate(directory: string): Promise<void> {
    const absolute = await this.#assertBundlePath(directory);
    await this.#prepareProtectedRoot();
    await this.#assertNoReparsePoints(absolute);
    if (await pathExists(absolute)) throw new Error("Production Wallet Store v2 is create-only.");
    await this.#assertAcl(this.#rootDirectory, true);
  }

  async assertAfterCommit(directory: string): Promise<void> {
    const absolute = await this.#assertBundlePath(directory);
    const canonical = await this.#adapter.canonicalPath(absolute);
    if (normalizedPath(canonical) !== normalizedPath(absolute)) {
      throw new Error("Production Wallet Store v2 post-commit canonical path mismatch.");
    }
    await this.#assertAcl(this.#rootDirectory, true);
    await this.#assertAcl(absolute, false);
    await this.#assertAcl(resolve(absolute, WALLET_STORE_V2_STORE_FILE_NAME), false);
    await this.#assertAcl(resolve(absolute, WALLET_STORE_V2_MANIFEST_FILE_NAME), false);
    const backupMetadata = resolve(absolute, WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME);
    if (await pathExists(backupMetadata)) await this.#assertAcl(backupMetadata, false);
    const ceremonyMetadata = resolve(absolute, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME);
    if (await pathExists(ceremonyMetadata)) await this.#assertAcl(ceremonyMetadata, false);
  }

  async assertBeforeOpen(directory: string): Promise<void> {
    const absolute = await this.#assertBundlePath(directory);
    if (!(await pathExists(absolute))) throw new Error("Production Wallet Store v2 bundle is missing.");
    const canonical = await this.#adapter.canonicalPath(absolute);
    if (normalizedPath(canonical) !== normalizedPath(absolute)) {
      throw new Error("Production Wallet Store v2 open canonical path mismatch.");
    }
    await this.#assertAcl(this.#rootDirectory, true);
    await this.#assertAcl(absolute, false);
    await this.#assertAcl(resolve(absolute, WALLET_STORE_V2_STORE_FILE_NAME), false);
    await this.#assertAcl(resolve(absolute, WALLET_STORE_V2_MANIFEST_FILE_NAME), false);
    const backupMetadata = resolve(absolute, WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME);
    if (await pathExists(backupMetadata)) await this.#assertAcl(backupMetadata, false);
    const ceremonyMetadata = resolve(absolute, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME);
    if (await pathExists(ceremonyMetadata)) await this.#assertAcl(ceremonyMetadata, false);
  }

  async assertPublicFileBeforeCreate(
    path: string,
    kind: WalletStoreV2CeremonyPublicFileKind,
  ): Promise<void> {
    const absolute = this.#assertPublicFilePath(path, kind);
    await this.#prepareProtectedRoot();
    await this.#assertNoReparsePoints(absolute);
    if (await pathExists(absolute)) throw new Error("Wallet Store v2 ceremony file is create-only.");
    await this.#assertAcl(this.#rootDirectory, true);
  }

  async assertPublicFileAfterCommit(
    path: string,
    kind: WalletStoreV2CeremonyPublicFileKind,
  ): Promise<void> {
    const absolute = this.#assertPublicFilePath(path, kind);
    if (!(await pathExists(absolute))) throw new Error("Wallet Store v2 ceremony file is missing.");
    const canonical = await this.#adapter.canonicalPath(absolute);
    if (normalizedPath(canonical) !== normalizedPath(absolute)) {
      throw new Error("Wallet Store v2 ceremony file canonical path mismatch.");
    }
    await this.#assertAcl(this.#rootDirectory, true);
    await this.#assertAcl(absolute, false);
  }

  async assertPublicFileBeforeOpen(
    path: string,
    kind: WalletStoreV2CeremonyPublicFileKind,
  ): Promise<void> {
    const absolute = this.#assertPublicFilePath(path, kind);
    if (!(await pathExists(absolute))) throw new Error("Wallet Store v2 ceremony file is missing.");
    await this.#assertNoReparsePoints(absolute);
    const canonical = await this.#adapter.canonicalPath(absolute);
    if (normalizedPath(canonical) !== normalizedPath(absolute)) {
      throw new Error("Wallet Store v2 ceremony file canonical path mismatch.");
    }
    await this.#assertAcl(this.#rootDirectory, true);
    await this.#assertAcl(absolute, false);
  }
}

export function createDefaultWindowsWalletStoreV2ProductionSecurity(
  rootDirectory: string,
): WindowsWalletStoreV2ProductionFileSecurity {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is required for production Wallet Store v2.");
  const synchronizedDirectories = [
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
  ].filter((value): value is string => Boolean(value));
  return new WindowsWalletStoreV2ProductionFileSecurity({
    rootDirectory,
    localAppDataDirectory: localAppData,
    synchronizedDirectories,
    adapter: new PowerShellWindowsAclAdapter(),
  });
}
