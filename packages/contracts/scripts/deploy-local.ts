import { createLocalDemoConnection, deployLocalDemoV1 } from "./lib/local-demo.js";

console.log("LOCAL DRY-RUN ONLY: no external RPC or public blockchain is used.");
const connection = await createLocalDemoConnection();
await deployLocalDemoV1(connection);
console.log("LOCAL DRY-RUN PASSED");
