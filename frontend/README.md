# Kosha frontend

Next.js 16 (App Router), TypeScript, Tailwind CSS 4, ethers 6 and SWR. It talks to the Kosha backend on `:4000`
and to the chain through the browser wallet (MetaMask).

```bash
cp .env.local.example .env.local
npm install
npm run dev        # http://localhost:3000 (start the chain and backend first)
npm run build      # production build + type check
```

## Pages

| Page | Who | What it does |
| --- | --- | --- |
| `/` Pool | Everyone | Pool size, the three-pocket band, limits the contract enforces, today's numbers, book checks, latest AI proposal, members |
| `/member` | Members | Balance, deposit e-Rupee, withdraw or queue a withdrawal, cash out, borrow on an invoice, repay, statement |
| `/committee` | Everyone reads, committee signs | Proposals, the AI's explanation, every quoted figure against the chain, the 11 rule checks, sign / add signature / withdraw signature / veto / run |
| `/partner` | The licensed partner | Settle or return deposits, review invoices (with override note for flagged ones), loan book with write-off, KYC |
| `/audit` | Everyone | Chain events, proposal hash verification, book-check history |
| `/ops` | Local demo only | Time travel, run keeper, check books, run or forge the agent, break the second RPC, exporter pays, tight pool, reset |

## MetaMask setup (local chain)

1. Add a network: RPC `http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`. The app offers to add it for you.
2. Import the accounts you need from the private keys printed by `npm run node`:
   #1 partner (Kalinga Finserv), #3 #4 #5 committee (Prakash, Sasmita, Rakesh), #6 Meera, #8 Lipika, #11 Ashok.
   These keys are public test keys. Use a separate browser profile and never send real funds to them.
3. After restarting the chain or using Reset demo, clear MetaMask's activity (Settings, Advanced, Clear activity tab data).

## Code layout

```
app/                 one folder per page, plus layout.tsx and providers.tsx
components/ui/       Button, Panel, Badge, Field, Tabs, Modal, Copy, Empty, Countdown
components/layout/   Header, BottomNav (phones), Banners, WalletButton, Gate, PageHead
components/pool/     TreasuryBand, CapMeters, ReconcilerCard
components/member/   DepositForm, WithdrawForm, BorrowForm, RepayList, Statement
components/committee StatusBadge, SplitChange, Evidence + Rules, Timeline, Actions
components/invoice/  InvoiceReport (shared by member and partner)
components/partner/  InvoiceReview
lib/                 api, wallet (connect + sign-in), hooks (SWR), contracts (+ plain-language errors), tx (progress toasts), format, people, types
```

Design: colours come from Sambalpuri ikat (indigo, river teal, turmeric) on a cool paper background; type is Mukta, with
JetBrains Mono only for hashes and addresses. Every page works from 360 px phones (bottom tab bar) to desktop.
