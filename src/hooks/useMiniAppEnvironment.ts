import { useEffect, useState } from "react";
import { isInFarcasterMiniApp } from "../farcaster";

export function useMiniAppEnvironment(): boolean {
  const [isMiniApp, setIsMiniApp] = useState(false);

  useEffect(() => {
    let active = true;
    void isInFarcasterMiniApp().then((detected) => {
      if (active) setIsMiniApp(detected);
    });
    return () => {
      active = false;
    };
  }, []);

  return isMiniApp;
}
