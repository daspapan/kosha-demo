require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const { SOLC_FROM_NPM, SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

// Offline fallback: use the solc-js compiler from npm when SOLC_FROM_NPM=1
// (useful behind firewalls that block binaries.soliditylang.org).
if (SOLC_FROM_NPM === "1") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion === "0.8.24") {
      const compilerPath = path.join(__dirname, "node_modules", "solc", "soljson.js");
      return { compilerPath, isSolcJs: true, version: args.solcVersion, longVersion: "0.8.24+commit.e11b9ed9" };
    }
    return runSuper();
  });
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { accounts: { count: 30 } },
    localhost: { url: "http://127.0.0.1:8545" },
    docker: { url: "http://chain:8545" },
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? {  sepolia: {
        url: SEPOLIA_RPC_URL || "",
        accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      },
    } : {}),
  },
  etherscan: { 
    apiKey: ETHERSCAN_API_KEY || "" 
  },
};
