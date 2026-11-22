"use client";

// Data hooks. SWR caches each backend call and refreshes it in the background.

import useSWR from "swr";
import { fetcher } from "./api";
import { useWallet } from "./wallet";
import type { ChainConfig, Invoice, LedgerEvent, Loan, Me, Member, OpsStatus, Pool, ProposalDetail, ProposalSummary } from "./types";

const FAST = { refreshInterval: 4000 };
const SLOW = { refreshInterval: 15000 };

export const useConfig = () => useSWR<ChainConfig>(["/config", null], fetcher, { revalidateOnFocus: false });
export const usePool = () => useSWR<Pool>(["/pool", null], fetcher, FAST);
export const useRegistry = () => useSWR<{ members: Member[]; exporters: { exporter_id: string; name: string; gstin: string; gst_status: string }[] }>(["/registry", null], fetcher, { revalidateOnFocus: false });
export const useProposals = () => useSWR<{ proposals: ProposalSummary[] }>(["/proposals", null], fetcher, FAST);
export const useProposal = (id: number | null) => useSWR<ProposalDetail>(id ? [`/proposals/${id}`, null] : null, fetcher, FAST);
export const useLoans = () => useSWR<{ now: number; loans: Loan[] }>(["/loans", null], fetcher, SLOW);
export const useAuditEvents = () => useSWR<{ events: LedgerEvent[] }>(["/audit/events?limit=300", null], fetcher, FAST);
export const useReconcilerRuns = () => useSWR<{ runs: { id: number; at: string; block: number; ok: boolean; details: { name: string; ok: boolean }[]; pause_tx: string | null }[] }>(["/audit/reconciler", null], fetcher, SLOW);
export const useOpsStatus = () => useSWR<OpsStatus>(["/ops/status", null], fetcher, FAST);

export function useMe() {
  const { token } = useWallet();
  return useSWR<Me>(token ? ["/me", token] : null, fetcher, FAST);
}

export function useMyInvoices() {
  const { token } = useWallet();
  return useSWR<{ invoices: Invoice[] }>(token ? ["/invoices", token] : null, fetcher, FAST);
}

export function usePartnerQueue() {
  const { token, roles } = useWallet();
  return useSWR<{ deposits: { id: number; member: string; amount: number; createdAt: number; txHash: string }[]; invoices: Invoice[] }>(
    token && roles?.partner ? ["/partner/queue", token] : null, fetcher, FAST);
}
