import { sdk } from "@farcaster/miniapp-sdk";

let detection: Promise<boolean> | undefined;

export function isInFarcasterMiniApp(): Promise<boolean> {
  detection ??= sdk.isInMiniApp();
  return detection;
}

export async function signalFarcasterReady(): Promise<void> {
  if (await isInFarcasterMiniApp()) {
    await sdk.actions.ready();
  }
}
