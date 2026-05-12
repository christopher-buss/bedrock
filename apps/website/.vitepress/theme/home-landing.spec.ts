import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";
import { render, screen } from "@testing-library/vue";

import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import HomeLanding from "./home-landing.vue";

const frontmatter = ref<{ layout?: string }>({});
const isDark = ref(false);

// vitepress's useData returns a 12+ field VitePressData; partial stubbing via
// the typed import("...") form is impractical, so use the string form here.
// eslint-disable-next-line vitest/prefer-import-in-mock -- see note above
vi.mock("vitepress", () => ({ useData: () => ({ frontmatter, isDark }) }));

describe(HomeLanding, () => {
	it("should render the install command and the current bedrock version", () => {
		expect.assertions(2);

		render(HomeLanding);

		expect(screen.getAllByText("pnpm add @bedrock-rbx/core")).not.toHaveLength(0);
		expect(screen.getAllByText(`v${bedrockVersion}`)).not.toHaveLength(0);
	});
});
