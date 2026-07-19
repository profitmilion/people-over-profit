import {
  fullLifecycle99DryRunSummary,
  fullLifecycle99InitializationSummary,
  fullLifecycle99InspectionSummary,
  initializeFullLifecycle99Store,
  inspectFullLifecycle99Store,
  planFullLifecycle99Initialization,
} from "./operator/full-lifecycle-wallet-store.js";

function sanitizeCommandError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Wallet-store command failed.";
  return raw
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b(?:0x)?[0-9a-f]{64}\b/gi, "[redacted-64-byte-value]")
    .replace(
      /\b(private key|mnemonic|seed phrase|password|passphrase)\s*[:=]\s*[^\r\n]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the secure PowerShell launcher.`);
  return value;
}

async function main(): Promise<void> {
  const mode = requiredEnvironment("POP33_FULL_LIFECYCLE_MODE");
  const targetDirectory = requiredEnvironment("POP33_FULL_LIFECYCLE_TARGET_DIRECTORY");
  try {
    if (mode === "dry-run") {
      console.log(fullLifecycle99DryRunSummary(
        await planFullLifecycle99Initialization({ targetDirectory }),
      ));
      return;
    }
    if (mode === "inspect") {
      console.log(fullLifecycle99InspectionSummary(
        await inspectFullLifecycle99Store({
          targetDirectory,
          password: requiredEnvironment("POP33_FULL_LIFECYCLE_PASSWORD_FIRST"),
        }),
      ));
      return;
    }
    if (mode === "initialize") {
      console.log(fullLifecycle99InitializationSummary(
        await initializeFullLifecycle99Store({
          targetDirectory,
          password: requiredEnvironment("POP33_FULL_LIFECYCLE_PASSWORD_FIRST"),
          repeatedPassword: requiredEnvironment("POP33_FULL_LIFECYCLE_PASSWORD_SECOND"),
          confirmation: requiredEnvironment("POP33_FULL_LIFECYCLE_CONFIRMATION"),
        }),
      ));
      return;
    }
    throw new Error("Unsupported full-lifecycle wallet-store mode.");
  } finally {
    delete process.env.POP33_FULL_LIFECYCLE_MODE;
    delete process.env.POP33_FULL_LIFECYCLE_TARGET_DIRECTORY;
    delete process.env.POP33_FULL_LIFECYCLE_PASSWORD_FIRST;
    delete process.env.POP33_FULL_LIFECYCLE_PASSWORD_SECOND;
    delete process.env.POP33_FULL_LIFECYCLE_CONFIRMATION;
  }
}

void main().catch((error: unknown) => {
  console.error(`Full-lifecycle wallet-store command stopped: ${sanitizeCommandError(error)}`);
  console.error("No RPC connection or transaction was attempted.");
  process.exitCode = 1;
});
