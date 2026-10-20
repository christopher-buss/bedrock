<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { computed } from "vue";

import ComingSoon from "./coming-soon.vue";
import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();
const layout = computed(() => frontmatter.value["layout"]);
</script>

<template>
	<ComingSoon v-if="layout === 'coming-soon'" />
	<HomeLanding v-else-if="layout === 'landing'" />
	<DefaultLayout v-else />
</template>
