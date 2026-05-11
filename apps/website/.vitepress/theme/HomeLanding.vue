<script setup lang="ts">
import { useData } from "vitepress";

const { isDark } = useData();

function toggleTheme() {
	isDark.value = !isDark.value;
}
</script>

<template>
	<div class="bedrock-landing">
		<nav class="bedrock-nav">
			<div class="wrap inner">
				<a class="brand" href="#">
					<span class="brand-mark">
						<span /><span /><span /><span />
					</span>
					Bedrock<span class="nav-v">v0.1</span>
				</a>
				<div class="nav-links">
					<a href="#pipeline">How it works</a>
					<a href="#features">Features</a>
					<a href="#install">Quickstart</a>
					<a href="#ecosystem">Ocale</a>
					<a href="/bedrock/guide/getting-started">Docs</a>
				</div>
				<button
					class="theme-toggle"
					aria-label="Toggle theme"
					@click="toggleTheme"
				>
					<svg
						v-if="!isDark"
						class="icon-moon"
						viewBox="0 0 16 16"
						fill="none"
					>
						<path
							d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linejoin="round"
						/>
					</svg>
					<svg
						v-else
						class="icon-sun"
						viewBox="0 0 16 16"
						fill="none"
					>
						<circle
							cx="8"
							cy="8"
							r="3"
							stroke="currentColor"
							stroke-width="1.4"
						/>
						<path
							d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<a
					class="nav-cta"
					href="https://github.com/christopher-buss/bedrock"
				>
					GitHub
					<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
						<path
							d="M3 9L9 3M9 3H4M9 3V8"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</a>
			</div>
		</nav>
	</div>
</template>

<style scoped>
.bedrock-landing {
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

	--accent: #5c7da6;
	--accent-soft: #a8bdd8;
	--accent-deep: #324a6e;
	--accent-bg: #e4ebf5;

	--ok: #4a8a64;
	--warn: #c89a3a;
	--del: #b5523a;

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Instrument Serif", "Times New Roman", serif;
	--f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

	--r-sm: 4px;
	--r: 8px;
	--r-lg: 14px;

	--ease: cubic-bezier(0.2, 0.7, 0.2, 1);

	min-height: 100vh;
	background: var(--bg);
	color: var(--ink);
	font-family: var(--f-sans);
	font-size: 16px;
	line-height: 1.55;
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

html.dark .bedrock-landing {
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

	--accent: #7a9ac4;
	--accent-soft: #b8c9e0;
	--accent-deep: #4e6c92;
	--accent-bg: #1e2840;
}

.bedrock-landing,
.bedrock-landing .bedrock-nav {
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-landing a {
	color: inherit;
	text-decoration: none;
}

.bedrock-landing button {
	font: inherit;
	cursor: pointer;
	border: 0;
	background: none;
	color: inherit;
	padding: 0;
}

.bedrock-landing ::selection {
	background: var(--accent);
	color: #fff;
}

.wrap {
	max-width: 1200px;
	margin: 0 auto;
	padding: 0 32px;
}

.bedrock-nav {
	position: sticky;
	top: 0;
	z-index: 40;
	backdrop-filter: blur(14px);
	background: var(--bg-nav);
	border-bottom: 1px solid var(--line);
}

.bedrock-nav .inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 60px;
}

.nav-links {
	display: flex;
	gap: 28px;
}

.nav-links a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.nav-links a:hover {
	color: var(--ink);
}

.nav-cta {
	font-size: 13px;
	padding: 6px 12px 6px 14px;
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	transition: all 0.15s var(--ease);
}

.nav-cta:hover {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--bg);
}

.nav-v {
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--ink-4);
	padding: 2px 6px;
	background: var(--bg-soft);
	border-radius: 3px;
	margin-left: 8px;
}

.theme-toggle {
	width: 32px;
	height: 32px;
	border: 1px solid var(--line);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--ink-2);
	transition: all 0.15s var(--ease);
	margin-right: 6px;
}

.theme-toggle:hover {
	border-color: var(--ink-3);
	color: var(--ink);
	background: var(--bg-soft);
}

.theme-toggle svg {
	width: 14px;
	height: 14px;
}

.brand {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	font-family: var(--f-serif);
	font-size: 23px;
	letter-spacing: -0.01em;
}

.brand-mark {
	width: 22px;
	height: 22px;
	display: grid;
	grid-template-rows: repeat(4, 1fr);
	gap: 2px;
}

.brand-mark span {
	background: var(--ink);
	border-radius: 1px;
}

.brand-mark span:nth-child(1) {
	opacity: 0.3;
}

.brand-mark span:nth-child(2) {
	opacity: 0.55;
}

.brand-mark span:nth-child(3) {
	opacity: 0.8;
}

.brand-mark span:nth-child(4) {
	background: var(--accent);
	opacity: 1;
}
</style>
