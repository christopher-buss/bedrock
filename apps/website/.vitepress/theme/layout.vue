<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData, withBase } from "vitepress";
import { computed } from "vue";

import BedrockNav from "./components/bedrock-nav.vue";
import HomeIntroduction from "./home-introduction.vue";
import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();

const useBedrockShell = computed(
	() => frontmatter.value.layout === "landing" || frontmatter.value.layout === "introduction",
);

const showSearch = computed(() => frontmatter.value.layout === "introduction");
</script>

<template>
	<div v-if="useBedrockShell" class="bedrock-shell">
		<BedrockNav :home-href="withBase('/')" :show-search="showSearch" />
		<HomeLanding v-if="frontmatter.layout === 'landing'" />
		<HomeIntroduction v-else-if="frontmatter.layout === 'introduction'" />
	</div>
	<DefaultLayout v-else />
</template>

<style scoped>
/* Design tokens for the shared Bedrock chrome. Lifted up from the per-layout
   components so that the persistent BedrockNav can read them too, and so
   tokens don't drift between the landing and introduction containers. */
.bedrock-shell {
	--bg: #f4f6fa;
	--bg-soft: #e9edf3;
	--bg-card: #ffffff;
	--bg-nav: rgba(244, 246, 250, 0.78);
	--ink: #0e131a;
	--ink-2: #2a3240;
	--ink-3: #5a6472;
	--ink-4: #8b95a4;
	--line: #dde2eb;
	--line-strong: #c4cbd6;

	--dark-bg: #0c1018;
	--dark-bg-2: #131826;
	--dark-bg-3: #1c2235;
	--dark-line: #232a3a;
	--dark-ink: #eef1f7;
	--dark-ink-2: #b9c1d0;
	--dark-ink-3: #6f7889;

	--accent: #5944a2;
	--accent-soft: #a8bdd8;
	--accent-deep: #324a6e;
	--accent-bg: #e4ebf5;
	--accent-em: var(--accent-deep);

	--ok: #4a8a64;
	--warn: #c89a3a;
	--del: #b5523a;

	--kind-fn: oklch(62% 0.115 235);
	--kind-type: oklch(68% 0.105 75);
	--kind-cls: oklch(58% 0.095 145);
	--kind-const: oklch(60% 0.115 305);

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Source Serif 4", "Source Serif Pro", "Times New Roman", serif;
	--f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

	--r-sm: 4px;
	--r: 8px;
	--r-lg: 14px;

	--ease: cubic-bezier(0.2, 0.7, 0.2, 1);
}

html.dark .bedrock-shell {
	--bg: #0d1119;
	--bg-soft: #141a26;
	--bg-card: #1a2030;
	--bg-nav: rgba(13, 17, 25, 0.78);
	--ink: #eef1f7;
	--ink-2: #c1c8d4;
	--ink-3: #828b9c;
	--ink-4: #565e6e;
	--line: #232a39;
	--line-strong: #2f3849;

	--dark-bg: #080b12;
	--dark-bg-2: #0f1320;
	--dark-bg-3: #161c2c;
	--dark-line: #1e2434;

	--accent-soft: #b8c9e0;
	--accent-deep: #4e6c92;
	--accent-bg: #1e2840;
	--accent-em: var(--accent-soft);
}
</style>
