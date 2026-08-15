import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import { OPERATOR_WORKSPACE_ROOT } from "./checkpoint.js";

export interface AtomicWriteHooks {
  afterFileSync?(): Promise<void> | void;
  beforeRename?(): Promise<void> | void;
  afterRename?(): Promise<void> | void;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function withExclusiveFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }), "utf8");
      await handle.sync();
      break;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        handle = undefined;
        await unlink(lockPath).catch(() => undefined);
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 0) throw error;
      let stale = false;
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
        stale = typeof lock.pid === "number" && Number.isSafeInteger(lock.pid) && !processIsAlive(lock.pid);
      } catch {
        throw new Error("Operator state lock exists but cannot be safely validated.");
      }
      if (!stale) throw new Error("Operator state is locked by another live process.");
      await unlink(lockPath);
    }
  }
  if (!handle) throw new Error("Unable to acquire operator state lock.");

  const release = async (ignoreErrors: boolean): Promise<void> => {
    await handle.close().catch(() => undefined);
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
      if (lock.token === token) await unlink(lockPath);
    } catch (error) {
      if (!ignoreErrors && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };

  let result: T;
  try {
    result = await operation();
  } catch (error) {
    await release(true);
    throw error;
  }
  await release(false);
  return result;
}

function normalizedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizedPath(candidate);
  const normalizedParent = normalizedPath(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${sep}`)
  );
}

export async function assertSafeExternalFilePath(
  filePath: string,
  requiredSuffix: string,
): Promise<string> {
  if (!isAbsolute(filePath)) throw new Error("Operator state path must be absolute.");
  if (!filePath.toLowerCase().endsWith(requiredSuffix.toLowerCase())) {
    throw new Error(`Operator state path must end with ${requiredSuffix}.`);
  }

  const target = resolve(filePath);
  const workspace = await realpath(OPERATOR_WORKSPACE_ROOT);
  if (isInside(target, workspace)) {
    throw new Error("Operator state path must be outside the workspace.");
  }

  const root = parse(target).root;
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Operator state path crosses a symlink: ${current}`);
      }
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error(`Operator state parent is not a directory: ${current}`);
      }
      if (index === segments.length - 1 && !stats.isFile()) {
        throw new Error("Operator state target must be a regular file.");
      }
      const canonical = await realpath(current);
      if (normalizedPath(canonical) !== normalizedPath(current)) {
        throw new Error(`Operator state path crosses a redirected entry: ${current}`);
      }
      if (isInside(canonical, workspace)) {
        throw new Error("Operator state path resolves inside the workspace.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

export async function pathIsRegularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Operator state target must be a regular non-symlink file.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function atomicWritePrivateFile(
  filePath: string,
  content: string,
  hooks: AtomicWriteHooks = {},
): Promise<void> {
  const parent = dirname(filePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = join(parent, `.${randomUUID()}.operator-state.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await hooks.afterFileSync?.();
    await handle.close();
    handle = undefined;
    await hooks.beforeRename?.();
    await rename(temporaryPath, filePath);
    renamed = true;
    await chmod(filePath, 0o600).catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== "win32") throw error;
    });
    await hooks.afterRename?.();
  } finally {
    await handle?.close().catch(() => undefined);
    if (!renamed) {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}
