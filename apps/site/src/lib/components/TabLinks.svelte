<script lang="ts">
  import { page } from "$app/state";
  import { listKeys } from "#lib/keys.ts";

  /** A page's tab row: each tab a link. One row, which scrolls sideways when it does not fit. */
  let { items }: { items: Array<[href: string, label: string]> } = $props();

  // The open tab is the URL's alone: the longest tab address the path is or sits under, else the first (a page with no version shows its head's).
  const current = $derived.by(() => {
    const here = page.url.pathname;
    const under = items.filter(([href]) => here === href || here.startsWith(href + "/"));
    return under.reduce((best, [href]) => (href.length > best.length ? href : best), "") || items[0]?.[0];
  });
</script>

<div class="tabs" {@attach listKeys("a", "x")}>
  {#each items as [href, label] (href)}
    <a {href} aria-current={href === current ? "page" : undefined}>{label}</a>
  {/each}
</div>
