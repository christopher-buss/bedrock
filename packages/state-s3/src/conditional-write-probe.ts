import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { classifyS3Failure, isConditionRefusal, type S3Failure } from "./classify-failure.ts";
import { ABSENT } from "./lock-object.ts";

// What the scratch object holds. An operator who finds one left behind by a
// probe that was killed mid-run should be able to read what wrote it.
const SCRATCH_BODY = JSON.stringify({ wrote: "bedrock conditional-write probe" });

/** What one probe learned about the store's conditional creates. */
export type ConditionalWriteProbe = HonouredProbe | IgnoredProbe | UnprovenProbe;

/** A probe that did not leave a conditional create worth relying on. */
export type FailedProbe = IgnoredProbe | UnprovenProbe;

/** The scratch object one probe writes, and the client to write it with. */
export interface ProbeTarget {
	/** The scratch object the probe writes twice. */
	readonly key: string;
	/** Bucket the scratch object is written in. */
	readonly bucket: string;
	/** The configured S3 client. */
	readonly client: S3Client;
}

/**
 * The store refused a create of an object it already held, so a hold taken
 * with one is a hold.
 */
interface HonouredProbe {
	/** Which outcome this is. */
	readonly kind: "honoured";
}

/**
 * The store took a create of an object it already held, so it grants every
 * run that asks the same hold.
 */
interface IgnoredProbe {
	/** Which outcome this is. */
	readonly kind: "ignored";
}

/**
 * A refusal got in the way, so the store said nothing about its
 * conditional creates either way.
 */
interface UnprovenProbe {
	/** The refusal that got in the way. */
	readonly failure: S3Failure;
	/** Which outcome this is. */
	readonly kind: "unproven";
}

/**
 * Prove the store refuses a create of an object it already holds.
 *
 * The scratch object is written once with nothing asked of it, then
 * written again requiring it to be absent. A store that refuses the
 * second one evaluates the condition, which is what a hold rests on. A
 * store that takes it evaluated nothing, and every run that ever asks it
 * for the same **Environment** would be told it holds one.
 *
 * The scratch object is taken away once the answer is in, whichever answer
 * that is. A write can land at the store and lose its answer on the way
 * back, so the refused round takes it away too and nothing the probe
 * wrote outlives it.
 *
 * @param target - The scratch object to write, and the client to write it
 * with.
 * @returns What the store proved about its conditional creates.
 */
export async function probeConditionalWritesAsync(
	target: ProbeTarget,
): Promise<ConditionalWriteProbe> {
	const seeded = await writeScratchAsync(target, undefined);
	if (seeded !== undefined) {
		await discardScratchAsync(target);
		return { failure: seeded, kind: "unproven" };
	}

	const refused = await writeScratchAsync(target, ABSENT);
	await discardScratchAsync(target);

	if (refused === undefined) {
		return { kind: "ignored" };
	}

	return isConditionRefusal(refused)
		? { kind: "honoured" }
		: { failure: refused, kind: "unproven" };
}

/**
 * Take the scratch object away.
 *
 * A refusal here is passed over: the store has already said what the probe
 * asked it, and an object under the segment a lifecycle rule expires is
 * not worth ending a deploy over.
 *
 * @param target - The scratch object to take away.
 */
async function discardScratchAsync({ key, bucket, client }: ProbeTarget): Promise<void> {
	try {
		await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
	} catch {
		// The lifecycle rule that expires the locks expires this too.
	}
}

/**
 * Write the scratch object, requiring it to be absent when asked to.
 *
 * @param target - The scratch object to write, and the client to write it
 * with.
 * @param ifNoneMatch - The wildcard requiring the object to be absent, or
 * `undefined` to write it whatever is there.
 * @returns The refusal, or `undefined` once the write has landed.
 */
async function writeScratchAsync(
	{ key, bucket, client }: ProbeTarget,
	ifNoneMatch: string | undefined,
): Promise<S3Failure | undefined> {
	try {
		await client.send(
			new PutObjectCommand({
				Body: SCRATCH_BODY,
				Bucket: bucket,
				IfNoneMatch: ifNoneMatch,
				Key: key,
			}),
		);
		return undefined;
	} catch (err) {
		return classifyS3Failure(err);
	}
}
