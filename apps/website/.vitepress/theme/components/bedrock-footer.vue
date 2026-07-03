<script setup lang="ts">
import { computed } from "vue";

import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

export interface BedrockFooterLink {
	readonly external?: boolean;
	readonly href: string;
	readonly text: string;
}

export interface BedrockFooterColumn {
	readonly links: ReadonlyArray<BedrockFooterLink>;
	readonly title: string;
}

interface Props {
	readonly columns: ReadonlyArray<BedrockFooterColumn>;
	readonly homeHref?: string;
	readonly tagline?: string;
}

const {
	columns,
	homeHref = "/",
	tagline = "Infrastructure-as-Code for Roblox. Typed, Open Cloud only.",
} = defineProps<Props>();

const VERSION = `v${bedrockVersion}`;

const gridTemplateColumns = computed(() => `1.4fr repeat(${columns.length}, 1fr)`);
</script>

<template>
	<footer class="bedrock-foot">
		<div class="wrap">
			<div class="foot" :style="{ gridTemplateColumns }">
				<div class="foot-brand">
					<a class="brand" :href="homeHref">
						<span class="brand-mark"> <span /><span /><span /><span /> </span>
						Bedrock
					</a>
					<p>{{ tagline }}</p>
				</div>
				<div v-for="column in columns" :key="column.title">
					<h5>{{ column.title }}</h5>
					<ul>
						<li v-for="link in column.links" :key="link.href">
							<a
								:href="link.href"
								:rel="link.external ? 'noopener noreferrer' : undefined"
								:target="link.external ? '_blank' : undefined"
							>
								{{ link.text }}
							</a>
						</li>
					</ul>
				</div>
			</div>
			<div class="foot-bottom">
				<div>&copy; 2026 &middot; MIT Licensed &middot; {{ VERSION }}</div>
				<div>built with vitepress</div>
			</div>
		</div>
	</footer>
</template>

<style scoped>
.bedrock-foot {
	padding: 72px 0 48px;
	background: var(--bg-soft);
	border-top: 1px solid var(--line);
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-foot a {
	color: inherit;
	text-decoration: none;
}

.wrap {
	max-width: var(--bedrock-wrap, 1200px);
	margin: 0 auto;
	padding: 0 32px;
}

.foot {
	display: grid;
	gap: 48px;
	margin-bottom: 56px;
}

.foot-brand .brand {
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

.foot-brand p {
	font-size: 14px;
	color: var(--ink-3);
	max-width: 34ch;
	margin: 14px 0 0;
	line-height: 1.55;
}

.foot h5 {
	font-family: var(--f-mono);
	font-size: 11px;
	font-weight: 500;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-3);
	margin: 0 0 16px;
}

.foot ul {
	list-style: none;
	padding: 0;
	margin: 0;
}

.foot li {
	margin-bottom: 10px;
}

.foot a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.foot a:hover {
	color: var(--ink);
}

.foot-bottom {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding-top: 28px;
	border-top: 1px solid var(--line);
	font-size: 12px;
	color: var(--ink-4);
	font-family: var(--f-mono);
}

@media (max-width: 960px) {
	.foot {
		grid-template-columns: 1fr !important;
		gap: 40px;
	}
}

@media (max-width: 760px) {
	.wrap {
		padding: 0 20px;
	}

	.foot {
		grid-template-columns: 1fr 1fr !important;
		gap: 24px;
	}
}
</style>
