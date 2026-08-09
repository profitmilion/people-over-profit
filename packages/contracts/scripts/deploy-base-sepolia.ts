import { network } from "hardhat";

import {
  BASE_SEPOLIA_CHAIN_ID,
  readBaseSepoliaDeploymentConfig,
} from "./lib/demo-v1-config.js";
import {
  deployPop33BasicV1,
  printDeploymentResult,
  printDeploymentSummary,
  requireBaseSepoliaDeploymentBalance,
  requireEstimatedDeploymentBalance,
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
await requireBaseSepoliaDeploymentBalance(ethers, deployer.address);

await validatePaymentToken(ethers, deploymentConfig.paymentTokenAddress);
await requireEstimatedDeploymentBalance(
  ethers,
  deployer.address,
  "Pop33BasicV1",
  [deploymentConfig.paymentTokenAddress, deploymentConfig.drawIntervalSeconds, deploymentConfig.positionsPerPool],
);

const summary = {
  networkName: "Base Sepolia",
  chainId: currentNetwork.chainId,
  deployer: deployer.address,
  paymentTokenAddress: deploymentConfig.paymentTokenAddress,
  drawIntervalSeconds: deploymentConfig.drawIntervalSeconds,
  positionsPerPool: deploymentConfig.positionsPerPool,
};

printDeploymentSummary(summary);
console.log("Deployment variant: existing external 6-decimal payment token.");
console.log("All validation passed. Submitting the Pop33BasicV1 deployment transaction.");

const pop33 = await deployPop33BasicV1(
  ethers,
  deploymentConfig.paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
  deploymentConfig.positionsPerPool,
);
await verifyPop33BasicV1Deployment(
  pop33,
  deploymentConfig.paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
  deploymentConfig.positionsPerPool,
);
await printDeploymentResult(pop33, summary);
