import { network } from "hardhat";

import {
  DEMO_V1_PARAMETERS,
  LOCAL_HARDHAT_CHAIN_ID,
} from "./demo-v1-config.js";
import {
  type DynamicContract,
  deployPop33BasicV1,
  printDeploymentResult,
  printDeploymentSummary,
  validatePaymentToken,
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

  const token = (await ethers.deployContract("MockUSDC")) as DynamicContract;
  await token.waitForDeployment();
  const paymentTokenAddress = await token.getAddress();
  await validatePaymentToken(ethers, paymentTokenAddress);

  const summary = {
    networkName: "hardhatOp (local only)",
    chainId: currentNetwork.chainId,
    deployer: deployer.address,
    paymentTokenAddress,
    drawIntervalSeconds: DEMO_V1_PARAMETERS.drawIntervalSeconds,
  };
  if (logOutput) printDeploymentSummary(summary);

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
