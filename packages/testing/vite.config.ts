import { sharedConfig } from "@bedrock-rbx/vite-config";

// A spread, not `export { sharedConfig as default } from`: knip 6.45 does
// not follow a re-exported default, so it would miss the Vitest specs.
export default { ...sharedConfig };
