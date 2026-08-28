<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";

import ComingSoon from "./coming-soon.vue";
import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
	<ComingSoon v-if="frontmatter.layout === 'coming-soon'" />
	<HomeLanding v-else-if="frontmatter.layout === 'landing'" />
	<DefaultLayout v-else />
</template>
