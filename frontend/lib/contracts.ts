// Contract handles for the signed-in wallet, built from the ABIs the backend serves (/api/config).

import { Contract, Interface, type JsonRpcSigner, type InterfaceAbi } from "ethers";
import type { ChainConfig } from "./types";

export type KoshaContracts = {
  eInr: Contract; arc: Contract; kyc: Contract; gsec: Contract; vault: Contract; gateway: Contract; timelock: Contract; multisig: Contract;
};

export function contractsFor(config: ChainConfig, signer: JsonRpcSigner): KoshaContracts {
  const make = (name: keyof KoshaContracts) => new Contract(config.addresses[name], config.abis[name] as InterfaceAbi, signer);
  return {
    eInr: make("eInr"), arc: make("arc"), kyc: make("kyc"), gsec: make("gsec"),
    vault: make("vault"), gateway: make("gateway"), timelock: make("timelock"), multisig: make("multisig"),
  };
}

// Plain-language versions of the contracts' custom errors
const FRIENDLY: Record<string, string> = {
  NotVerified: "This wallet is not KYC-verified by the partner.",
  ReceiverNotVerified: "The receiving wallet is not KYC-verified.",
  NotMember: "Only members who hold vault shares can borrow.",
  ZeroAmount: "Enter an amount above zero.",
  InsufficientLiquidity: "The buffer does not hold enough money for this right now.",
  BufferBelowMinimum: "This would take the buffer below its 15% floor.",
  GsecCapExceeded: "This would put more than 50% of the pool in government securities.",
  InvoiceCapExceeded: "This would put more than 35% of the pool in invoice loans.",
  MemberCapExceeded: "This would lend one member more than 5% of the pool.",
  InvoiceAlreadyUsed: "This invoice has already been financed.",
  BadDueDate: "The due date must be within the next 180 days.",
  RateTooHigh: "The interest rate is above the 30% limit.",
  BadLoanStatus: "This loan is not open any more.",
  GraceNotOver: "A loan can be written off only 30 days after its due date.",
  BadRedeemStatus: "This redemption request is not in the right state for that.",
  NotRequestOwner: "Only the member who made this request can do that.",
  EnforcedPause: "The pool is paused. Withdrawals still work; new deposits, allocations and loans do not.",
  NotOwner: "Only committee members can do this.",
  AlreadyConfirmed: "You have already signed this proposal.",
  NotConfirmed: "You have not signed this proposal.",
  ProposalClosed: "This proposal is already scheduled, executed or cancelled.",
  TooEarly: "A deposit can be cancelled only 3 days after the request.",
  DuplicateRequest: "This deposit request was already sent.",
  NotPending: "This deposit is not pending any more.",
  ERC4626ExceededMaxDeposit: "Deposits are not possible right now (the pool may be paused, or this wallet is not verified).",
  ERC4626ExceededMaxRedeem: "That is more than the buffer can pay today. Use a queued redemption instead.",
  ERC4626ExceededMaxWithdraw: "That is more than the buffer can pay today. Use a queued redemption instead.",
  TimelockUnexpectedOperationState: "The 24-hour wait has not finished yet, or this change was cancelled.",
  ERC20InsufficientBalance: "Not enough balance in this wallet.",
  AccessControlUnauthorizedAccount: "This wallet does not have permission for that.",
};

/** Turns a wallet or contract error into one sentence a member can act on. */
export function explainError(err: unknown, config?: ChainConfig): string {
  const e = err as { code?: string | number; shortMessage?: string; message?: string; data?: string; info?: { error?: { data?: string } }; revert?: { name?: string } };
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "You cancelled the request in your wallet.";
  let name = e?.revert?.name;
  const data = e?.data ?? e?.info?.error?.data;
  if (!name && data && config) {
    for (const abi of Object.values(config.abis)) {
      try {
        const parsed = new Interface(abi as InterfaceAbi).parseError(data);
        if (parsed) { name = parsed.name; break; }
      } catch { /* try the next contract */ }
    }
  }
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  if (name) return `The contract refused this (${name}).`;
  return e?.shortMessage ?? e?.message ?? "Something went wrong.";
}
