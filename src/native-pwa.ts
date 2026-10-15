import { useState } from "react";

// Native builds ship their web assets inside the app; no service worker is needed.
export function useRegisterSW() {
  const offlineReady = useState(false);
  const needRefresh = useState(false);
  return {
    offlineReady,
    needRefresh,
    updateServiceWorker: async () => undefined,
  };
}
