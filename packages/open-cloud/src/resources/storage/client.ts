import type { OpenCloudClientOptions } from "../../client/types.ts";
import { ResourceClient } from "../../internal/resource-client.ts";
import { MemoryStoreQueuesGroup } from "./queues-group.ts";
import { MemoryStoreSortedMapsGroup } from "./sorted-maps-group.ts";

/**
 * Public client for the Roblox Open Cloud `Data and memory stores`
 * Feature. Today it covers memory-store queues via the
 * {@link StorageClient.queues} Operation Group and memory-store sorted
 * maps via the {@link StorageClient.sortedMaps} Operation Group; a
 * future data-stores Operation Group slots in as a sibling on the same
 * client.
 *
 * Every method returns a `Result` so callers handle failure
 * explicitly; no thrown error ever escapes the client.
 *
 * @example
 *
 * ```ts
 * import { StorageClient } from "@bedrock-rbx/ocale/storage";
 *
 * const client = new StorageClient({ apiKey: "your-key" });
 * expect(client).toBeInstanceOf(StorageClient);
 * ```
 */
export class StorageClient {
	/** Memory-store queue Operation Group. */
	public readonly queues: MemoryStoreQueuesGroup;
	/** Memory-store sorted-map Operation Group. */
	public readonly sortedMaps: MemoryStoreSortedMapsGroup;

	/**
	 * Creates a new {@link StorageClient}. Configuration is frozen on
	 * construction; per-request overrides are accepted on each method.
	 *
	 * @param options - Client-level configuration including the API key.
	 */
	constructor(options: OpenCloudClientOptions) {
		const inner = new ResourceClient(options);
		this.queues = new MemoryStoreQueuesGroup(inner);
		this.sortedMaps = new MemoryStoreSortedMapsGroup(inner);
	}
}
