// A `.bedrock/deploy.ts` override that fails, so the e2e test can assert the
// real CLI propagates the non-zero override exit into its own exit code.
import process from "node:process";

process.exit(3);
