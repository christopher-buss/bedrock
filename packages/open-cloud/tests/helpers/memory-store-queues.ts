import type { MemoryStoreQueueItemWire } from "#src/domains/cloud-v2/memory-store-queues/wire";

/**
 * Builds a minimally-valid {@link MemoryStoreQueueItemWire} body. Pass
 * an `overrides` object to tweak fields without re-stating the defaults.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validQueueItemBody(
	overrides: Partial<MemoryStoreQueueItemWire> = {},
): MemoryStoreQueueItemWire {
	return {
		data: "hello",
		expireTime: "2026-06-21T15:08:58.4806559Z",
		path: "cloud/v2/universes/123/memory-store/queues/test-queue/items/abc123",
		priority: 1,
		...overrides,
	};
}
