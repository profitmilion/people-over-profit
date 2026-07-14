import { network } from "hardhat";

import {
  DEMO_V1_PARAMETERS,
  LOCAL_HARDHAT_CHAIN_ID,
} from "./demo-v1-config.js";
import {
  type DynamicContract,
  deployPop33DemoUSDC,
  deployPop33BasicV1,
  printDemoTokenDeploymentResult,
  printDemoTokenPairDeploymentSummary,
  printDeploymentResult,
  printDeploymentSummary,
  verifyPop33DemoUSDCDeployment,
  verifyPop33BasicV1Deployment,
} from "./deployment.js";

export async function createLocalDemoConnection() {
  return network.create({
    network: "hardhatOp",
    chainType: "op",
  });
}

export async function deployLocalDemoV1(
  connection: Awaited<ReturnType<typeof createLocalDemoConnection>>,
  logOutput = true,
) {
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== LOCAL_HARDHAT_CHAIN_ID) {
    throw new Error(
      `Local dry-run expected chain ID ${LOCAL_HARDHAT_CHAIN_ID}, received ${currentNetwork.chainId}.`,
    );
  }

  const token = (await deployPop33DemoUSDC(
    ethers,
    DEMO_V1_PARAMETERS.dripAmount,
    DEMO_V1_PARAMETERS.dripCooldownSeconds,
  )) as DynamicContract;
  const paymentTokenAddress = await token.getAddress();
  await verifyPop33DemoUSDCDeployment(
    ethers,
    token,
    DEMO_V1_PARAMETERS.dripAmount,
    DEMO_V1_PARAMETERS.dripCooldownSeconds,
  );

  const tokenSummary = {
    networkName: "hardhatOp (local only)",
    chainId: currentNetwork.chainId,
    deployer: deployer.address,
    dripAmount: DEMO_V1_PARAMETERS.dripAmount,
    dripCooldownSeconds: DEMO_V1_PARAMETERS.dripCooldownSeconds,
    drawIntervalSeconds: DEMO_V1_PARAMETERS.drawIntervalSeconds,
  };

  const summary = {
    networkName: "hardhatOp (local only)",
    chainId: currentNetwork.chainId,
    deployer: deployer.address,
    paymentTokenAddress,
    drawIntervalSeconds: DEMO_V1_PARAMETERS.drawIntervalSeconds,
  };
  if (logOutput) {
    printDemoTokenPairDeploymentSummary(tokenSummary);
    await printDemoTokenDeploymentResult(token, tokenSummary);
    printDeploymentSummary(summary);
  }

  const pop33 = await deployPop33BasicV1(
    ethers,
    paymentTokenAddress,
    DEMO_V1_PARAMETERS.drawIntervalSeconds,
  );
  await verifyPop33BasicV1Deployment(
    pop33,
    paymentTokenAddress,
    DEMO_V1_PARAMETERS.drawIntervalSeconds,
  );

  if (logOutput) await printDeploymentResult(pop33, summary);
  return { ...connection, deployer, token, pop33, summary };
}
