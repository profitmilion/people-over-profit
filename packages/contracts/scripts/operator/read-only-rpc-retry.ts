import { sanitizeOperatorError } from "./transaction-journal.js";

export const READ_ONLY_RPC_RETRY_DEFAULTS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
});

export interface ReadOnlyRpcRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  log?: (message: string) => void;
}

export class ReadOnlyRpcRateLimitExhaustedError extends Error {
  override readonly name = "ReadOnlyRpcRateLimitExhaustedError";
}

const RATE_LIMIT_MESSAGE =
  /(?:over|exceeded|reached)?[ -_]?(?:the )?rate[ -_]?limit|too many requests|request limit exceeded|quota exceeded|throttl(?:e|ed|ing)|http(?: status)?\s*429|status(?: code)?\s*[:=]?\s*429/i;
const INSPECTED_KEYS = new Set([
  "code",
  "status",
  "statusCode",
  "message",
  "shortMessage",
  "reason",
  "error",
  "info",
  "response",
  "body",
]);

function collectRateLimitEvidence(
  value: unknown,
  codes: Set<string>,
  messages: string[],
  seen: Set<object>,
  depth: number,
): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === "number") {
    codes.add(String(value));
    return;
  }
  if (typeof value === "string") {
    messages.push(value);
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Error) messages.push(value.message);
  const record = value as Record<string, unknown>;
  for (const key of INSPECTED_KEYS) {
    let nested: unknown;
    try {
      nested = record[key];
    } catch {
      continue;
    }
    if (nested === undefined) continue;
    if ((key === "code" || key === "status" || key === "statusCode") &&
        (typeof nested === "string" || typeof nested === "number")) {
      codes.add(String(nested));
    }
    collectRateLimitEvidence(nested, codes, messages, seen, depth + 1);
  }
}

export function isReadOnlyRpcRateLimitError(error: unknown): boolean {
  const codes = new Set<string>();
  const messages: string[] = [];
  collectRateLimitEvidence(error, codes, messages, new Set<object>(), 0);
  if (codes.has("-32016") || codes.has("-32005") || codes.has("429")) return true;
  return messages.some((message) => RATE_LIMIT_MESSAGE.test(message) || /\b-32016\b/.test(message));
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function retryDelay(attempt: number, options: Required<Pick<
  ReadOnlyRpcRetryOptions,
  "baseDelayMs" | "maxDelayMs" | "jitterRatio" | "random"
>>): number {
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * (2 ** (attempt - 1)));
  const sampled = options.random();
  const random = Number.isFinite(sampled) && sampled >= 0 && sampled <= 1 ? sampled : 0.5;
  const multiplier = 1 + options.jitterRatio * ((2 * random) - 1);
  return Math.max(0, Math.round(exponential * multiplier));
}

export async function withReadOnlyRpcRetry<T>(
  operationLabel: string,
  operation: () => Promise<T>,
  options: ReadOnlyRpcRetryOptions = {},
): Promise<T> {
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? READ_ONLY_RPC_RETRY_DEFAULTS.maxAttempts,
    "Read-only RPC max attempts",
    1,
    10,
  );
  const baseDelayMs = boundedInteger(
    options.baseDelayMs ?? READ_ONLY_RPC_RETRY_DEFAULTS.baseDelayMs,
    "Read-only RPC base delay",
    0,
    60_000,
  );
  const maxDelayMs = boundedInteger(
    options.maxDelayMs ?? READ_ONLY_RPC_RETRY_DEFAULTS.maxDelayMs,
    "Read-only RPC maximum delay",
    baseDelayMs,
    60_000,
  );
  const jitterRatio = options.jitterRatio ?? READ_ONLY_RPC_RETRY_DEFAULTS.jitterRatio;
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 0.5) {
    throw new Error("Read-only RPC jitter ratio must be between 0 and 0.5.");
  }
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const random = options.random ?? Math.random;
  const log = options.log ?? console.warn;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isReadOnlyRpcRateLimitError(error)) throw error;
      const safeError = sanitizeOperatorError(error);
      if (attempt === maxAttempts) {
        throw new ReadOnlyRpcRateLimitExhaustedError(
          `Read-only RPC ${operationLabel} remained rate-limited after ${maxAttempts} attempts: ${safeError}`,
        );
      }
      const delayMs = retryDelay(attempt, { baseDelayMs, maxDelayMs, jitterRatio, random });
      log(
        `READ-ONLY RPC RETRY: ${operationLabel}; next attempt ${attempt + 1}/${maxAttempts} in ${delayMs} ms; ${safeError}`,
      );
      await sleep(delayMs);
    }
  }
  throw new Error(`Read-only RPC ${operationLabel} exhausted its bounded retry loop.`);
}
