# Kosha contracts (local demo)

Solidity 0.8.24, Hardhat 2, OpenZeppelin Contracts 5. Testnet and local use only; not audited.

```bash
npm install
npx hardhat test          # 74 tests
npx hardhat coverage      # 100% lines and functions
npx hardhat node          # terminal 1
npx hardhat run scripts/deploy.js --network localhost   # terminal 2
```

If your network blocks binaries.soliditylang.org, prefix commands with `SOLC_FROM_NPM=1`
to compile with the `solc` npm package instead.

Sepolia: copy `.env.example` to `.env`, fill it in, then
`npx hardhat run scripts/deploy.js --network sepolia`.

Dummy data lives in `../data` (regenerate with `python3 generate.py` from that folder).
