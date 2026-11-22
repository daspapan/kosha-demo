// Shapes returned by the Kosha backend (backend/src/api/*). Amounts are in rupees unless the name says Wei.

export type Split = { bufferBps: number; gsecBps: number; invoiceBps: number };

export type ReconcilerCheck = { name: string; ok: boolean; chain?: string; ledger?: string; bank?: string; error?: string };

export type Pool = {
  block: number;
  timestamp: number;
  tvl: number;
  sharePrice: number;
  allocation: Split;
  amounts: { buffer: number; gsec: number; loans: number };
  caps: { bufferMinBps: number; gsecMaxBps: number; invoiceMaxBps: number; memberMaxBps: number; policyBufferMinBps: number };
  tbillAprBps: number;
  redemptions: { pendingAssets: number; expected7d: number; history: { days: number; mean7d: number; sd7d: number; max7d: number; formula: string } };
  loans: { activeCount: number; overdueCount: number };
  reserve: { ok: boolean; gatewayEinr: number; arcSupply: number; pendingDeposits: number };
  paused: boolean;
  reconciler: { at: string; block: number; ok: boolean; details: ReconcilerCheck[] } | null;
  latestProposal: { id: number; created_at: string; status: string; action: string; proposal_hash: string } | null;
};

export type Roles = { partner: boolean; keeper: boolean; pauser: boolean; committee: boolean; verified: boolean; member: boolean };

export type Member = { member_id: string; name: string; business: string; location: string; sector: string; address: string; kyc: string; gstin?: string };

export type Me = {
  address: string;
  roles: Roles;
  member: (Member & { deposit_inr: number }) | null;
  shares: string;
  value: number;
  eInr: number;
  arc: number;
  maxRedeemShares: string;
  deposits: { id: number; amount: number; status: string; txHash: string; createdAt: number }[];
  loans: { id: number; principal: number; rateBps: number; openedAt: number; dueDate: number; status: string; interestDue: number; invoiceHash: string }[];
  redeems: { id: number; shares: string; assets: number; status: string; txHash: string }[];
  statement: { block: number; ts: number; contract: string; event: string; args: Record<string, string>; txHash: string }[];
};

export type Violation = { rule: string; name: string; msg: string };
export type Evidence = { name: string; cited: number; chain: number | null; match: boolean };

export type Proposal = {
  blockNumber: number;
  snapshotHash: string;
  action: "ALLOCATE_TO_GSEC" | "REQUEST_FROM_GSEC" | "NO_ACTION";
  current: Split;
  target: Split;
  dataPoints: { name: string; value: number }[];
  confidence: "low" | "medium" | "high";
  rationale: string;
  wouldChangeIf: string;
};

export type OnChain = {
  state: "not_submitted" | "awaiting_signatures" | "scheduled" | "executed" | "cancelled";
  proposalId?: number;
  confirmations?: number;
  confirmedBy?: string[];
  cancelledBy?: string;
  readyAt?: number;
  executed?: boolean;
  operationId?: string;
};

export type ProposalSummary = {
  id: number;
  createdAt: string;
  status: "ready" | "rejected" | "no_action";
  source: "agent" | "forged";
  action: string | null;
  confidence: string | null;
  rationale: string | null;
  proposalHash: string;
  failed: string[];
  onChain: OnChain | null;
};

export type ProposalDetail = {
  id: number;
  createdAt: string;
  blockNumber: number;
  status: ProposalSummary["status"];
  signable: boolean;
  source: string;
  proposal: Proposal | null;
  snapshot: { tvl: number; allocation: Split; blockTimestamp: number };
  validation: { ok: boolean; signable: boolean; violations: Violation[]; passed: string[]; evidence?: Evidence[]; notes: string[] };
  proposalHash: string;
  snapshotHash: string;
  model: string | null;
  meta: { latencyMs?: number; ollamaVersion?: string; injected?: boolean };
  submit: { target: string; value: string; data: string; salt: string; proposalHash: string; amountWei: string } | null;
  rules: Record<string, string>;
  onChain: OnChain | null;
};

export type InvoiceCheck = { name: string; ok: boolean; detail: string; expected: string | number | null; actual: string | number | null };

export type Invoice = {
  id: number;
  uploadedAt: string;
  member: string;
  fileSha256: string;
  status: "verified" | "flagged" | "rejected" | "approved" | "error";
  reason: string | null;
  extraction: { invoiceNo: string; sellerName: string; sellerGstin: string; buyerName: string; buyerGstin: string; invoiceDate: string; dueDate: string; amountInr: number; goods: string } | null;
  checks: InvoiceCheck[];
  guard: { flagged: boolean; rules: { why: string; quote: string }[]; hidden: { why: string; quote: string }[]; model: { injection: boolean; evidence: string; error?: boolean } | null } | null;
  invoiceHash: string | null;
  principal: number | null;
  loanId: number | null;
  txHash: string | null;
};

export type Loan = {
  id: number; borrower: string; name: string | null; business: string | null; principal: number; rateBps: number;
  openedAt: number; dueDate: number; status: string; interestDue: number; overdue: boolean; writeOffFrom: number; invoiceHash: string;
};

export type LedgerEvent = { id: number; block: number; tx_hash: string; log_index: number; contract: string; event: string; args: Record<string, string>; ts: number };

export type ChainConfig = { chainId: number; addresses: Record<string, string>; deployBlock: number; abis: Record<string, unknown[]>; demo: boolean };

export type OpsStatus = { block: number; timestamp: number; chaos: "off" | "stale" | "lie"; keeper: { at: string; did: unknown[] } | null; agentLastSeen: number | null; demoSnapshot: string | null; paused: boolean };
