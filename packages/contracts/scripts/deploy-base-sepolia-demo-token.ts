import { network } from "hardhat";

import {
  assertDemoPop33DeploymentConfirmation,
  BASE_SEPOLIA_CHAIN_ID,
  readBaseSepoliaDemoTokenDeploymentConfig,
} from "./lib/demo-v1-config.js";
import {
  deployPop33BasicV1,
  deployPop33DemoUSDC,
  printDemoTokenDeploymentResult,
  printDemoTokenPairDeploymentSummary,
  printDeploymentResult,
  printDeploymentSummary,
  requireBaseSepoliaDeploymentBalance,
  requireEstimatedDeploymentBalance,
  verifyPop33BasicV1Deployment,
  verifyPop33DemoUSDCDeployment,
} from "./lib/deployment.js";

const deploymentConfig = readBaseSepoliaDemoTokenDeploymentConfig(process.env);
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

const pairSummary = {
  networkName: "Base Sepolia",
  chainId: currentNetwork.chainId,
  deployer: deployer.address,
  dripAmount: deploymentConfig.dripAmount,
  dripCooldownSeconds: deploymentConfig.dripCooldownSeconds,
  drawIntervalSeconds: deploymentConfig.drawIntervalSeconds,
  positionsPerPool: deploymentConfig.positionsPerPool,
};
printDemoTokenPairDeploymentSummary(pairSummary);
console.log("First explicit confirmation validated. Deploying POP33 Demo USD.");

const token = await deployPop33DemoUSDC(
  ethers,
  deploymentConfig.dripAmount,
  deploymentConfig.dripCooldownSeconds,
);
await verifyPop33DemoUSDCDeployment(
  ethers,
  token,
  deploymentConfig.dripAmount,
  deploymentConfig.dripCooldownSeconds,
);
await printDemoTokenDeploymentResult(token, pairSummary);

// Re-read the independent confirmation immediately before the second public write.
assertDemoPop33DeploymentConfirmation(process.env);
const paymentTokenAddress = await token.getAddress();
await requireEstimatedDeploymentBalance(
  ethers,
  deployer.address,
  "Pop33BasicV1",
  [paymentTokenAddress, deploymentConfig.drawIntervalSeconds, deploymentConfig.positionsPerPool],
);

const pop33Summary = {
  networkName: "Base Sepolia",
  chainId: currentNetwork.chainId,
  deployer: deployer.address,
  paymentTokenAddress,
  drawIntervalSeconds: deploymentConfig.drawIntervalSeconds,
  positionsPerPool: deploymentConfig.positionsPerPool,
};
printDeploymentSummary(pop33Summary);
console.log("Second explicit confirmation validated. Deploying Pop33BasicV1.");

const pop33 = await deployPop33BasicV1(
  ethers,
  paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
  deploymentConfig.positionsPerPool,
);
await verifyPop33BasicV1Deployment(
  pop33,
  paymentTokenAddress,
  deploymentConfig.drawIntervalSeconds,
  deploymentConfig.positionsPerPool,
);
await printDeploymentResult(pop33, pop33Summary);
console.log("Two-contract deployment completed and validated");
console.log(`  POP33 Demo USD: ${paymentTokenAddress}`);
console.log(`  Pop33BasicV1: ${await pop33.getAddress()}`);
