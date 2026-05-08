import type { OpenCloudClientOptions } from "../../client/types.ts";
import { ResourceClient } from "../../internal/resource-client.ts";
import { MemoryStoreQueuesGroup } from "./queues-group.ts";

/**
 * Public client for the Roblox Open Cloud `Data and memory stores`
 * Feature. Today it covers memory-store queues via the
 * {@link StorageClient.queues} Operation Group; future Operation
 * Groups for sorted maps and data stores slot in as siblings on the
 * same client.
 *
 * Every method returns a `Result` so callers handle failure
 * explicitly; no thrown error ever escapes the client.
 *
 * @example
 *
 * ```ts
 * import { StorageClient } from "@bedrock/ocale/storage";
 *
 * const client = new StorageClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(StorageClient);
 * ```
 */
export class StorageClient {
	/** Memory-store queue Operation Group. */
	public readonly queues: MemoryStoreQueuesGroup;

	/**
	 * Creates a new {@link StorageClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		const inner = new ResourceClient(options);
		this.queues = new MemoryStoreQueuesGroup(inner);
	}
}
