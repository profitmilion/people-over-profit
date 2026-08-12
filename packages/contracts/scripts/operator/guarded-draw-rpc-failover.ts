export type GuardedDrawRpcProviderHealth =
  | "HEALTHY"
  | "UNAVAILABLE"
  | "WRONG_CHAIN"
  | "NO_CONTRACT_BYTECODE";

export interface GuardedDrawRpcProviderReport {
  index: number;
  name: string;
  endpoint: string;
  health: GuardedDrawRpcProviderHealth;
  chainId: string | null;
  contractBytecodePresent: boolean | null;
}

export interface GuardedDrawRpcTelemetry {
  providerIndex: number | null;
  providerName: string | null;
  readOnlyRetries: number;
  failoverOccurred: boolean;
  providers: GuardedDrawRpcProviderReport[];
}

export interface GuardedDrawRpcEndpoint<Client> {
  name: string;
  maskedEndpoint: string;
  client: Client;
}

export interface GuardedDrawRpcHealthResult {
  chainId: bigint;
  contractBytecodePresent: boolean;
}

export interface GuardedDrawRpcFailoverOptions<Client> {
  endpoints: readonly GuardedDrawRpcEndpoint<Client>[];
  expectedChainId: bigint;
  healthCheck(client: Client): Promise<GuardedDrawRpcHealthResult>;
  maxAttemptsPerProvider?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

interface ProviderState<Client> extends GuardedDrawRpcEndpoint<Client> {
  index: number;
  health: GuardedDrawRpcProviderHealth;
  chainId: bigint | null;
  contractBytecodePresent: boolean | null;
}

const LOGICAL_REVERT =
  /execution reverted|contract function .*reverted|contractfunctionreverted|revert reason|custom error/i;
const TRANSIENT_INFRASTRUCTURE =
  /\b(?:429|502|503|504)\b|bad gateway|service unavailable|gateway timeout|timed?\s*out|timeout|econnreset|connection reset|connection refused|socket hang up|fetch failed|network error|temporarily unavailable|block at number .* could not be found|transaction(?: receipt)? .* (?:could not be found|not found)|transactionreceiptnotfound|header not found|rate.?limit|too many requests/i;
const INSPECTED_ERROR_KEYS = [
  "code",
  "status",
  "statusCode",
  "message",
  "shortMessage",
  "details",
  "reason",
  "cause",
  "error",
  "response",
] as const;

function collectErrorEvidence(
  value: unknown,
  evidence: string[],
  seen: Set<object>,
  depth: number,
): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number") {
    evidence.push(String(value));
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Error) evidence.push(value.message, value.name);
  const record = value as Record<string, unknown>;
  for (const key of INSPECTED_ERROR_KEYS) {
    let nested: unknown;
    try {
      nested = record[key];
    } catch {
      continue;
    }
    collectErrorEvidence(nested, evidence, seen, depth + 1);
  }
}

export function isTransientGuardedDrawRpcError(error: unknown): boolean {
  const evidence: string[] = [];
  collectErrorEvidence(error, evidence, new Set<object>(), 0);
  const joined = evidence.join("\n");
  if (LOGICAL_REVERT.test(joined)) return false;
  return TRANSIENT_INFRASTRUCTURE.test(joined);
}

export class GuardedDrawRpcFailoverExhaustedError extends Error {
  override readonly name = "GuardedDrawRpcFailoverExhaustedError";
}

export class GuardedDrawReadOnlyRpcFailover<Client> {
  readonly #providers: ProviderState<Client>[];
  readonly #expectedChainId: bigint;
  readonly #healthCheck: (client: Client) => Promise<GuardedDrawRpcHealthResult>;
  readonly #maxAttempts: number;
  readonly #retryDelayMs: number;
  readonly #sleep: (delayMs: number) => Promise<void>;
  #initialized: Promise<void> | null = null;
  #activeIndex: number | null = null;
  #readOnlyRetries = 0;
  #failoverOccurred = false;

  constructor(options: GuardedDrawRpcFailoverOptions<Client>) {
    if (options.endpoints.length === 0) {
      throw new Error("At least one guarded Draw RPC endpoint is required.");
    }
    const maxAttempts = options.maxAttemptsPerProvider ?? 2;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
      throw new Error("RPC attempts per provider must be an integer between 1 and 3.");
    }
    const retryDelayMs = options.retryDelayMs ?? 250;
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
      throw new Error("RPC retry delay must be an integer between 0 and 5000 milliseconds.");
    }
    this.#providers = options.endpoints.map((endpoint, index) => ({
      ...endpoint,
      index,
      health: "UNAVAILABLE",
      chainId: null,
      contractBytecodePresent: null,
    }));
    this.#expectedChainId = options.expectedChainId;
    this.#healthCheck = options.healthCheck;
    this.#maxAttempts = maxAttempts;
    this.#retryDelayMs = retryDelayMs;
    this.#sleep = options.sleep ?? ((delayMs) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  }

  async #attempt<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isTransientGuardedDrawRpcError(error)) throw error;
        if (attempt === this.#maxAttempts) throw error;
        this.#readOnlyRetries += 1;
        await this.#sleep(this.#retryDelayMs);
      }
    }
    throw new Error("Bounded guarded Draw RPC attempt loop exhausted.");
  }

  async #initialize(): Promise<void> {
    for (const provider of this.#providers) {
      try {
        const health = await this.#attempt(() => this.#healthCheck(provider.client));
        provider.chainId = health.chainId;
        provider.contractBytecodePresent = health.contractBytecodePresent;
        provider.health = health.chainId !== this.#expectedChainId
          ? "WRONG_CHAIN"
          : !health.contractBytecodePresent
            ? "NO_CONTRACT_BYTECODE"
            : "HEALTHY";
      } catch {
        provider.health = "UNAVAILABLE";
      }
    }
    const firstHealthy = this.#providers.find((provider) => provider.health === "HEALTHY");
    if (!firstHealthy) {
      throw new GuardedDrawRpcFailoverExhaustedError(
        "All configured Base Sepolia RPC endpoints failed guarded read-only health checks.",
      );
    }
    this.#activeIndex = firstHealthy.index;
    this.#failoverOccurred = firstHealthy.index > 0;
  }

  async initialize(): Promise<void> {
    this.#initialized ??= this.#initialize();
    return this.#initialized;
  }

  async read<T>(label: string, operation: (client: Client) => Promise<T>): Promise<T> {
    await this.initialize();
    const active = this.#activeIndex as number;
    const candidates = [
      this.#providers[active],
      ...this.#providers.filter((provider) =>
        provider.health === "HEALTHY" && provider.index !== active),
    ];
    let lastTransient: unknown;
    for (const provider of candidates) {
      try {
        const result = await this.#attempt(() => operation(provider.client));
        if (provider.index !== this.#activeIndex) this.#failoverOccurred = true;
        this.#activeIndex = provider.index;
        return result;
      } catch (error) {
        if (!isTransientGuardedDrawRpcError(error)) throw error;
        provider.health = "UNAVAILABLE";
        lastTransient = error;
      }
    }
    throw new GuardedDrawRpcFailoverExhaustedError(
      `All healthy Base Sepolia RPC endpoints failed during read-only operation ${label}.`,
      lastTransient === undefined ? undefined : { cause: lastTransient },
    );
  }

  async activeProvider(): Promise<GuardedDrawRpcEndpoint<Client>> {
    await this.initialize();
    const provider = this.#providers[this.#activeIndex as number];
    return {
      name: provider.name,
      maskedEndpoint: provider.maskedEndpoint,
      client: provider.client,
    };
  }

  telemetry(): GuardedDrawRpcTelemetry {
    const active = this.#activeIndex === null
      ? null
      : this.#providers[this.#activeIndex];
    return {
      providerIndex: active?.index ?? null,
      providerName: active?.name ?? null,
      readOnlyRetries: this.#readOnlyRetries,
      failoverOccurred: this.#failoverOccurred,
      providers: this.#providers.map((provider) => ({
        index: provider.index,
        name: provider.name,
        endpoint: provider.maskedEndpoint,
        health: provider.health,
        chainId: provider.chainId?.toString() ?? null,
        contractBytecodePresent: provider.contractBytecodePresent,
      })),
    };
  }
}
