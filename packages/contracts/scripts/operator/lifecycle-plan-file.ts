import { lstat, readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";

import {
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
} from "./durable-file.js";
import {
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
} from "./lifecycle-action-plan.js";

function normalized(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(candidate: string, parent: string): boolean {
  const child = normalized(candidate);
  const root = normalized(parent);
  return child === root || child.startsWith(`${root}${sep}`);
}

export function resolveLifecyclePlanPath(
  input: string,
  workingDirectory = process.cwd(),
): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Lifecycle plan path must not be empty.");
  if (extname(trimmed).toLowerCase() !== ".json") {
    throw new Error("Lifecycle plan path must end with .json.");
  }
  const target = resolve(workingDirectory, trimmed);
  if (!isAbsolute(trimmed) && !isInside(target, workingDirectory)) {
    throw new Error(
      "Relative lifecycle plan paths must remain inside the current working directory.",
    );
  }
  return target;
}

async function assertRegularNonSymlink(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("Lifecycle plan target must be a regular non-symlink file.");
  }
}

export async function readLifecyclePlanFile(
  input: string,
  workingDirectory = process.cwd(),
): Promise<{ path: string; json: string }> {
  const path = resolveLifecyclePlanPath(input, workingDirectory);
  await assertRegularNonSymlink(path);
  return { path, json: await readFile(path, "utf8") };
}

export async function writeLifecyclePlanFile(
  input: string,
  plan: LifecycleActionPlan,
  options: {
    overwrite?: boolean;
    workingDirectory?: string;
  } = {},
): Promise<string> {
  const path = resolveLifecyclePlanPath(
    input,
    options.workingDirectory ?? process.cwd(),
  );
  await withExclusiveFileLock(path, async () => {
    const exists = await pathIsRegularFile(path);
    if (exists && !options.overwrite) {
      throw new Error(
        "Lifecycle plan file already exists. Use --overwrite-plan to replace it explicitly.",
      );
    }
    if (exists) await assertRegularNonSymlink(path);
    await atomicWritePrivateFile(path, serializeLifecycleActionPlan(plan));
  });
  return path;
}
