import { network } from "hardhat";

import {
  BASE_SEPOLIA_CHAIN_ID,
  readBaseSepoliaDeploymentConfig,
} from "./lib/demo-v1-config.js";
import {
  deployPop33BasicV1,
  printDeploymentResult,
  printDeploymentSummary,
  validatePaymentToken,
  verifyPop33BasicV1Deployment,
} from "./lib/deployment.js";

const deploymentConfig = readBaseSepoliaDeploymentConfig(process.env);
const { ethers } = await network.create({
  network: "baseSepolia",
  chainType: "op",
});

const currentNetwork = await ethers.provider.getNetwork();
if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) {
  throw new Error(
    `Refusing deployment: expected Base Sepolia chain ID ${BASE_SEPOLIA_CHAIN_ID}, received ${currentNetwork.chainId}.`,
  );
}

const [deployer] = await ethers.getSigners();
const deployerBalance = await ethers.provider.getBalance(deployer.address);
if (deployerBalance === 0n) {
  throw new Error("Refusing deployment: deployer has no native token for gas.");
}

await validatePaymentToken(ethers, deploymentConfig.paymentTokenAddress);

const summary = {
  networkName: "Base Sepolia",
  chainId: currentNetwork.chainId,
  deployer: deployer.address,
  paymentTokenAddress: deploymentConfig.paymentTokenAddress,
  drawIntervalSeconds: deploymentConfig.drawIntervalSeconds,
};

printDeploymentSummary(summary);
console.log("All validation passed. Submitting the Pop33BasicV1 deployment transaction.");

const pop33 = await deployPop33BasicV1(
  ethers,
  deploymentConfig.paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
);
await verifyPop33BasicV1Deployment(
  pop33,
  deploymentConfig.paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
);
await printDeploymentResult(pop33, summary);
