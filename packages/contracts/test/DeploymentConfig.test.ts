import { expect } from "chai";

import {
  BASE_SEPOLIA_DEPLOY_CONFIRMATION,
  readBaseSepoliaDeploymentConfig,
} from "../scripts/lib/demo-v1-config.js";

const VALID_ENV: NodeJS.ProcessEnv = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
  BASE_SEPOLIA_USDC_ADDRESS: "0x0000000000000000000000000000000000000001",
  POP33_DEMO_DRAW_INTERVAL_SECONDS: "3600",
  POP33_BASE_SEPOLIA_DEPLOY_CONFIRM: BASE_SEPOLIA_DEPLOY_CONFIRMATION,
};

function withEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...VALID_ENV, ...overrides };
}

describe("Base Sepolia deployment configuration", function () {
  it("accepts a complete Demo V1 configuration without returning secrets", function () {
    const config = readBaseSepoliaDeploymentConfig(VALID_ENV);

    expect(config).to.deep.equal({
      paymentTokenAddress: "0x0000000000000000000000000000000000000001",
      drawIntervalSeconds: 3_600n,
    });
    expect(config).not.to.have.property("privateKey");
    expect(config).not.to.have.property("rpcUrl");
  });

  it("rejects missing or blank required values", function () {
    for (const name of Object.keys(VALID_ENV)) {
      expect(() => readBaseSepoliaDeploymentConfig(withEnv({ [name]: " " }))).to.throw(
        `${name} is required and cannot be empty.`,
      );
    }
  });

  it("rejects a non-HTTPS RPC URL", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_RPC_URL: "http://sepolia.base.org" }),
      ),
    ).to.throw("BASE_SEPOLIA_RPC_URL must use HTTPS.");
  });

  it("rejects local RPC endpoints for the public deployment path", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_RPC_URL: "https://localhost:8545" }),
      ),
    ).to.throw("BASE_SEPOLIA_RPC_URL must not point to a local endpoint.");
  });

  it("rejects URL credentials", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_RPC_URL: "https://user:secret@sepolia.base.org" }),
      ),
    ).to.throw("BASE_SEPOLIA_RPC_URL must not contain URL credentials.");
  });

  it("rejects malformed and zero private keys", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY: "0x1234" }),
      ),
    ).to.throw("must be a 32-byte 0x-prefixed private key");
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY: `0x${"0".repeat(64)}` }),
      ),
    ).to.throw("cannot be the zero key");
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY: `0x${"f".repeat(64)}` }),
      ),
    ).to.throw("outside the valid key range");
  });

  it("rejects malformed and zero payment-token addresses", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_USDC_ADDRESS: "not-an-address" }),
      ),
    ).to.throw("must be a valid EVM address");
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ BASE_SEPOLIA_USDC_ADDRESS: "0x0000000000000000000000000000000000000000" }),
      ),
    ).to.throw("cannot be the zero address");
  });

  it("rejects non-integer or non-Demo draw intervals", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ POP33_DEMO_DRAW_INTERVAL_SECONDS: "3600.5" }),
      ),
    ).to.throw("must be a positive integer");
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ POP33_DEMO_DRAW_INTERVAL_SECONDS: "86400" }),
      ),
    ).to.throw("must equal 3600 for Demo V1");
  });

  it("requires the exact explicit deployment confirmation phrase", function () {
    expect(() =>
      readBaseSepoliaDeploymentConfig(
        withEnv({ POP33_BASE_SEPOLIA_DEPLOY_CONFIRM: "yes" }),
      ),
    ).to.throw(`must equal ${BASE_SEPOLIA_DEPLOY_CONFIRMATION}`);
  });
});
