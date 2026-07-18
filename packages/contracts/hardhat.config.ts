import { configVariable, defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

export default defineConfig({
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatNetworkHelpers,
    hardhatVerify,
  ],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 31_337,
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84_532,
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY")],
    },
    baseSepoliaSmoke: {
      type: "http",
      chainType: "op",
      chainId: 84_532,
      url: configVariable("BASE_SEPOLIA_SMOKE_RPC_URL"),
      accounts: [],
    },
    baseSepoliaVerify: {
      type: "http",
      chainType: "op",
      chainId: 84_532,
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  test: {
    mocha: {
      timeout: 180_000,
    },
  },
});
