import { describe, expectTypeOf, it } from "vitest";

import type { DeployError } from "../shell/deploy.ts";
import type {
	DeployFailureEvent,
	DeploySuccessEvent,
	ProgressEvent,
	ProgressPort,
} from "./progress-port.ts";

describe("ProgressEvent", () => {
	it("should discriminate on the kind field", () => {
		expectTypeOf<ProgressEvent["kind"]>().toEqualTypeOf<
			| "applySummary"
			| "deployFailure"
			| "deploySuccess"
			| "resourceOpFailed"
			| "resourceOpNoop"
			| "resourceOpStarted"
			| "resourceOpSucceeded"
			| "stateWritten"
		>();
	});

	it("should narrow to DeploySuccessEvent on the deploySuccess kind", () => {
		expectTypeOf<
			Extract<ProgressEvent, { kind: "deploySuccess" }>
		>().toEqualTypeOf<DeploySuccessEvent>();
	});

	it("should narrow to DeployFailureEvent on the deployFailure kind", () => {
		expectTypeOf<
			Extract<ProgressEvent, { kind: "deployFailure" }>
		>().toEqualTypeOf<DeployFailureEvent>();
	});
});

describe("DeploySuccessEvent", () => {
	it("should carry environment and resourceCount", () => {
		expectTypeOf<DeploySuccessEvent>().toEqualTypeOf<{
			readonly environment: string;
			readonly kind: "deploySuccess";
			readonly resourceCount: number;
		}>();
	});
});

describe("DeployFailureEvent", () => {
	it("should carry environment and the full DeployError", () => {
		expectTypeOf<DeployFailureEvent>().toEqualTypeOf<{
			readonly environment: string;
			readonly error: DeployError;
			readonly kind: "deployFailure";
		}>();
	});
});

describe("ProgressPort.emit", () => {
	it("should accept a ProgressEvent as its single argument", () => {
		expectTypeOf<Parameters<ProgressPort["emit"]>[0]>().toEqualTypeOf<ProgressEvent>();
	});

	it("should return void", () => {
		expectTypeOf<ReturnType<ProgressPort["emit"]>>().toEqualTypeOf<void>();
	});
});
