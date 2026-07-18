import { readFile } from "node:fs/promises";

import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
} from "./durable-file.js";
import {
  OPERATOR_SET_MANIFEST_SUFFIX,
  validateOperatorSetManifest,
  type OperatorSetManifest,
} from "./operator-set-identity.js";

export async function writeOperatorSetManifest(
  filePathValue: string,
  manifest: OperatorSetManifest,
): Promise<void> {
  const validated = validateOperatorSetManifest(manifest);
  const filePath = await assertSafeExternalFilePath(filePathValue, OPERATOR_SET_MANIFEST_SUFFIX);
  if (await pathIsRegularFile(filePath)) throw new Error("Operator set manifest already exists.");
  await atomicWritePrivateFile(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

export async function readOperatorSetManifest(filePathValue: string): Promise<OperatorSetManifest> {
  const filePath = await assertSafeExternalFilePath(filePathValue, OPERATOR_SET_MANIFEST_SUFFIX);
  if (!(await pathIsRegularFile(filePath))) throw new Error("Operator set manifest does not exist.");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Operator set manifest is incomplete or invalid JSON.");
  }
  return validateOperatorSetManifest(value);
}

export function readOperatorSetManifestPathFromEnvironment(env: NodeJS.ProcessEnv): string {
  const value = env.OPERATOR_SET_MANIFEST_PATH?.trim();
  if (!value) throw new Error("OPERATOR_SET_MANIFEST_PATH is required.");
  return value;
}
