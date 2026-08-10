import { resolve } from "node:path";

import {
  EthersPilot10InventoryRuntime,
  PILOT_10_DEFAULT_RPC_URL,
  loadPublicWalletInventory,
  renderPilot10WalletInventory,
  runPilot10WalletInventory,
  validatePilot10InventoryRpcUrl,
} from "./operator/pilot-10-wallet-inventory.js";
import { sanitizeOperatorError } from "./operator/transaction-journal.js";

async function main(): Promise<void> {
  const inputPath = resolve(
    process.env.POP33_INTERNAL_PILOT_10_INVENTORY_PATH?.trim() ??
      "config/pilot-10-wallets.json",
  );
  const format = process.env.POP33_INTERNAL_PILOT_10_INVENTORY_FORMAT?.trim() ?? "both";
  if (!new Set(["text", "json", "both"]).has(format)) {
    throw new Error("Inventory output format must be text, json, or both.");
  }
  const rpcUrl = validatePilot10InventoryRpcUrl(
    process.env.BASE_SEPOLIA_INVENTORY_RPC_URL?.trim() ?? PILOT_10_DEFAULT_RPC_URL,
  );
  const wallets = await loadPublicWalletInventory(inputPath);
  const report = await runPilot10WalletInventory(
    new EthersPilot10InventoryRuntime(rpcUrl),
    wallets,
  );
  if (format === "text" || format === "both") console.log(renderPilot10WalletInventory(report));
  if (format === "both") console.log("\n--- JSON REPORT ---");
  if (format === "json" || format === "both") console.log(JSON.stringify(report, null, 2));
}

void main().catch((error: unknown) => {
  console.error(`Pilot 10 wallet inventory stopped: ${sanitizeOperatorError(error)}`);
  console.error("Safety result: no signer, signing, or broadcast path was loaded.");
  process.exitCode = 1;
});
