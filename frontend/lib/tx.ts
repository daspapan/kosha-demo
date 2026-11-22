"use client";

// Runs one or more wallet transactions in order, with a progress toast the user can follow.

import { toast } from "sonner";
import type { ContractTransactionResponse } from "ethers";
import { explainError } from "./contracts";
import type { ChainConfig } from "./types";

export type TxStep = { label: string; run: () => Promise<ContractTransactionResponse | null> };

export async function runSteps(title: string, steps: TxStep[], config?: ChainConfig, done?: string): Promise<boolean> {
  const id = toast.loading(title);
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const prefix = steps.length > 1 ? `Step ${i + 1} of ${steps.length}: ` : "";
      toast.loading(`${prefix}${step.label}. Confirm in your wallet.`, { id });
      const tx = await step.run();
      if (tx) {
        toast.loading(`${prefix}${step.label}. Waiting for the block.`, { id });
        await tx.wait();
      }
    }
    toast.success(done ?? `${title}: done`, { id });
    return true;
  } catch (err) {
    toast.error(explainError(err, config), { id, description: title });
    return false;
  }
}

/** Same idea for backend calls that do not need the wallet. */
export async function runApi<T>(title: string, call: () => Promise<T>, done?: (result: T) => string): Promise<T | null> {
  const id = toast.loading(title);
  try {
    const result = await call();
    toast.success(done ? done(result) : `${title}: done`, { id });
    return result;
  } catch (err) {
    toast.error((err as Error).message, { id, description: title });
    return null;
  }
}
