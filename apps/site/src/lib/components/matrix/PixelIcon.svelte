<script lang="ts">
  import { ICON_SIZE, iconPaths, type IconName } from "#lib/pixel-icons.ts";

  let { name, size = 36 }: { name: IconName; size?: number } = $props();
</script>

<svg class="pixel-icon" viewBox="0 0 {ICON_SIZE} {ICON_SIZE}" width={size} height={size} shape-rendering="crispEdges" aria-hidden="true">
  {#each iconPaths(name) as p (p.fill)}<path fill={p.fill} d={p.d} />{/each}
</svg>
