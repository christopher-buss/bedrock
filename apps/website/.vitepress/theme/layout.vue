<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";

import HomeIntroduction from "./home-introduction.vue";
import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
	<HomeLanding v-if="frontmatter.layout === 'landing'" />
	<HomeIntroduction v-else-if="frontmatter.layout === 'introduction'" />
	<DefaultLayout v-else />
</template>
