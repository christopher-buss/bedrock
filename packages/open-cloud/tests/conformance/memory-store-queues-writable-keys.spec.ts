import type { EnqueueQueueItemParameters } from "#src/domains/cloud-v2/memory-store-queues/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

/**
 * Hand-mirrored set of every writable field exposed by
 * `EnqueueQueueItemParameters`. Source-of-truth for two paired checks:
 *
 * - the type-level pin asserts the array is exhaustive against the
 *   parameter interface (minus the `queueId` and `universeId` URL
 *   fields), so a new parameter cannot land without an entry here;
 * - the runtime drift check asserts every entry is non-`readOnly` on
 *   the OpenAPI `MemoryStoreQueueItem` schema, so an entry cannot name
 *   a server-side readOnly field.
 */
const ENQUEUE_PARAMETER_KEYS = ["data", "priority", "ttl"] as const;

type EnqueueParameterKey = (typeof ENQUEUE_PARAMETER_KEYS)[number];

// Type-level pin: every key in the parameter interface (minus the
// queueId and universeId URL fields) must appear in the const array,
// and the array must not name a key that is not in the interface.
expectTypeOf<EnqueueParameterKey>().toEqualTypeOf<
	Exclude<keyof EnqueueQueueItemParameters, "queueId" | "universeId">
>();

describe("enqueueQueueItemParameters writable-keys pin", () => {
	it.for(ENQUEUE_PARAMETER_KEYS)(
		"should expose %s as a non-readOnly property on the MemoryStoreQueueItem schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("MemoryStoreQueueItem")).toContain(key);
		},
	);
});
