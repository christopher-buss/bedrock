import {
	type Mutant,
	type MutantTestPlan,
	PlanKind,
	type StrykerOptions,
} from "@stryker-mutator/api/core";
import { type TestResult, TestStatus } from "@stryker-mutator/api/test-runner";

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface TestCoverageLike {
	readonly hasCoverage: boolean;
	hasStaticCoverage(mutantId: string): boolean;
	readonly hitsByMutantId: Map<string, number>;
	readonly testsById: Map<string, TestResult>;
	readonly testsByMutantId: Map<string, Set<TestResult>>;
}

interface ReporterLike {
	onMutationTestingPlanReady(event: {
		readonly mutantPlans: ReadonlyArray<MutantTestPlan>;
	}): void;
}

interface SandboxLike {
	sandboxFileFor(fileName: string): string;
}

interface ProjectLike {
	readonly incrementalReport: undefined;
	readonly testFiles: ReadonlyArray<string>;
}

type PlannerOptions = Pick<
	StrykerOptions,
	"disableBail" | "ignoreStatic" | "timeoutFactor" | "timeoutMS" | "warnings"
>;

interface LoggerLike {
	isWarningEnabled(): boolean;
	warn(message: string): void;
}

type PlannerConstructor = new (
	testCoverage: TestCoverageLike,
	incrementalDiffer: unknown,
	reporter: ReporterLike,
	sandbox: SandboxLike,
	project: ProjectLike,
	timeOverheadMS: number,
	options: PlannerOptions,
	logger: LoggerLike,
) => { makePlan(mutants: ReadonlyArray<Mutant>): Promise<ReadonlyArray<MutantTestPlan>> };

type PlannerModule = Record<typeof PLANNER_EXPORT, PlannerConstructor>;

const PLANNER_EXPORT = "MutantTestPlanner";
const require = createRequire(import.meta.url);

describe("stryker static mutant planning patch", () => {
	it("should ignore static mutants even when Vitest reports per-test coverage", async () => {
		expect.assertions(1);

		const plannerModule = await loadPlannerModule();
		const test = {
			id: "src/schema.spec.ts#should validate product keys",
			name: "should validate product keys",
			fileName: "src/schema.spec.ts",
			status: TestStatus.Success,
			timeSpentMs: 1,
		} satisfies TestResult;
		const mutant = {
			id: "7",
			fileName: "src/schema.ts",
			location: {
				end: { column: 8, line: 410 },
				start: { column: 3, line: 410 },
			},
			mutatorName: "StringLiteral",
			replacement: "``",
		} satisfies Mutant;

		const planner = new plannerModule[PLANNER_EXPORT](
			{
				hasCoverage: true,
				hasStaticCoverage: () => true,
				hitsByMutantId: new Map([[mutant.id, 2]]),
				testsById: new Map([[test.id, test]]),
				testsByMutantId: new Map([[mutant.id, new Set([test])]]),
			},
			{},
			{ onMutationTestingPlanReady: () => {} },
			{ sandboxFileFor: (fileName) => fileName },
			{ incrementalReport: undefined, testFiles: [] },
			0,
			{
				disableBail: false,
				ignoreStatic: true,
				timeoutFactor: 1.5,
				timeoutMS: 5_000,
				warnings: false,
			},
			{ isWarningEnabled: () => false, warn: () => {} },
		);

		const [plan] = await planner.makePlan([mutant]);

		expect(plan).toMatchObject({
			mutant: {
				coveredBy: [test.id],
				static: true,
				status: "Ignored",
				statusReason: 'Static mutant (and "ignoreStatic" was enabled)',
			},
			plan: PlanKind.EarlyResult,
		});
	});
});

function isPlannerModule(value: unknown): value is PlannerModule {
	if (typeof value !== "object" || !value) {
		return false;
	}

	return PLANNER_EXPORT in value && typeof value[PLANNER_EXPORT] === "function";
}

async function loadPlannerModule(): Promise<PlannerModule> {
	const packageJsonPath = require.resolve("@stryker-mutator/core/package.json");
	// Stryker does not expose the planner publicly; this test verifies our pnpm
	// patch against the exact internal file it modifies.
	const plannerPath = join(dirname(packageJsonPath), "dist/src/mutants/mutant-test-planner.js");
	const module: unknown = await import(pathToFileURL(plannerPath).href);

	if (!isPlannerModule(module)) {
		throw new Error("Could not load Stryker MutantTestPlanner");
	}

	return module;
}
