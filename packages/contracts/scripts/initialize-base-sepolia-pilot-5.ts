import {
  initializePilotOperatorSet,
  pilotSetPublicSummary,
} from "./operator/pilot-set-initializer.js";
import { sanitizeOperatorError } from "./operator/transaction-journal.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the secure PowerShell launcher.`);
  return value;
}

async function main(): Promise<void> {
  try {
    const targetDirectory = requiredEnvironment("POP33_PILOT_TARGET_DIRECTORY");
    const password = requiredEnvironment("POP33_PILOT_PASSWORD_FIRST");
    const repeatedPassword = requiredEnvironment("POP33_PILOT_PASSWORD_SECOND");
    const confirmation = requiredEnvironment("POP33_PILOT_INITIALIZER_CONFIRMATION");
    const result = await initializePilotOperatorSet({
      targetDirectory,
      password,
      repeatedPassword,
      confirmation,
    });
    console.log(pilotSetPublicSummary(result));
  } finally {
    delete process.env.POP33_PILOT_TARGET_DIRECTORY;
    delete process.env.POP33_PILOT_PASSWORD_FIRST;
    delete process.env.POP33_PILOT_PASSWORD_SECOND;
    delete process.env.POP33_PILOT_INITIALIZER_CONFIRMATION;
  }
}

void main().catch((error: unknown) => {
  console.error(`Pilot operator-set initialization stopped: ${sanitizeOperatorError(error)}`);
  console.error("No Base Sepolia write was attempted.");
  process.exitCode = 1;
});
