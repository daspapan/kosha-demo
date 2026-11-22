// The cast of the demo video. Hardhat's public test accounts, so this list only works on the local chain.
// Never send real money to these addresses: their private keys are published on the internet.

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_ACCOUNTS === "true";

export const DEMO_ACCOUNTS = [
  { name: "Meera", role: "Member", address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9" }, // 0x976EA74026E726554dB657fA54763abd0C3a0aa9
  { name: "Lipika", role: "Member", address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955" },
  { name: "Ashok", role: "Member", address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f" },
  { name: "Kalinga Finserv", role: "Partner bank", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { name: "Prakash", role: "Committee 1", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { name: "Sasmita", role: "Committee 2", address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" },
  { name: "Rakesh", role: "Committee 3", address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" },
  { name: "Stranger", role: "Not verified", address: "0x553BC17A05702530097c3677091C5BB47a3a7931" },
];