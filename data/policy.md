# Kosha investment policy (demo, v1)

Approved by the risk committee. Read by the treasury agent and enforced by the validator.

1. Contract caps (cannot change): buffer at least 15%, G-secs at most 50%, invoice pool at most 35%, one member at most 5%.
2. Policy buffer target: keep the buffer at or above 20% after any allocation.
3. Redemption cover: the buffer after a move must cover 1.5 times expected 7-day redemptions.
4. Expected 7-day redemptions = mean + 2 standard deviations of rolling 7-day sums over the last 90 days.
5. Maximum move: 10% of TVL per day, in either direction.
6. Only buffer and G-sec moves are proposed by the agent. Invoice loans are decided by the partner.
7. If the T-bill yield falls below 300 bps, propose no new G-sec allocation.
8. Low confidence means no proposal.
9. Invoice loans: 80% of the invoice, 12% a year simple interest, due within 60 days.
