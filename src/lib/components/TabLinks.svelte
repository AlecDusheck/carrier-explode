<script lang="ts">
  /** A page's tab row: each tab a link, the current one marked. Scrolls sideways when it does not fit. */
  let { items, current }: { items: Array<[href: string, label: string]>; current: string } = $props();
</script>

{#each items as [href, label] (href)}
  <a {href} aria-current={href === current ? "page" : undefined}>{label}</a>
{/each}
