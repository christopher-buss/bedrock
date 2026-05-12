export type {
	DequeueQueueItemsParameters,
	DequeueResult,
	DiscardQueueItemsParameters,
	EnqueueQueueItemParameters,
	QueueItem,
} from "../../domains/cloud-v2/memory-store-queues/types.ts";
export type {
	CreateSortedMapItemParameters,
	DeleteSortedMapItemParameters,
	GetSortedMapItemParameters,
	SortedMapItem,
	SortKey,
} from "../../domains/cloud-v2/memory-store-sorted-maps/types.ts";
export { StorageClient } from "./client.ts";
