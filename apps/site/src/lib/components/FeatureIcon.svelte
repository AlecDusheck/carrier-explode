<script lang="ts">
  import { featureIcon, type FeatureIcon } from "#lib/feature-icons.ts";

  let { name, size }: { name: FeatureIcon; size: number } = $props();
</script>

<picture>
  <source srcset={featureIcon(name, "dark")} media="(prefers-color-scheme: dark)" />
  <img src={featureIcon(name, "light")} alt="" width={size} height={size} />
</picture>

<style>
  picture {
    display: flex;
  }
</style>
