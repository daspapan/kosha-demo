// Names for the demo's non-member roles. These are Hardhat's default test accounts (#1 to #5, #28, #29),
// so they only match on the local chain. Members come from the backend registry instead.

export const DEMO_PEOPLE: Record<string, { name: string; role: string }> = {
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": { name: "Kalinga Finserv", role: "Licensed partner (NBFC)" },
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": { name: "Keeper", role: "Automation account" },
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906": { name: "Prakash Mohanty", role: "Risk committee" },
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": { name: "Sasmita Das", role: "Risk committee" },
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc": { name: "Rakesh Behera", role: "Risk committee" },
  "0x40Fc963A729c542424cD800349a7E4Ecc4896624": { name: "Reconciler", role: "Automated monitor" },
  "0x9DCCe783B6464611f38631e6C851bf441907c710": { name: "T-bill issuer", role: "Mock RWA issuer" },
};

export function personName(address: string | null | undefined, members?: { address: string; name: string }[]): string | null {
  if (!address) return null;
  return DEMO_PEOPLE[address]?.name ?? members?.find((m) => m.address === address)?.name ?? null;
}
