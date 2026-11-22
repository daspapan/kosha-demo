"use client";

import { useCallback } from "react";
import { useConfig } from "./hooks";
import { useWallet } from "./wallet";
import { contractsFor } from "./contracts";

/** Returns a function that gives you the contracts, connected to the user's wallet so they can sign. */
export function useKosha() {
  const { data: config } = useConfig();
  const { getSigner, account } = useWallet();
  const contracts = useCallback(async () => {
    if (!config) throw new Error("Still loading the contract addresses. Try again in a moment.");
    return contractsFor(config, await getSigner());
  }, [config, getSigner]);
  return { config, contracts, account };
}
