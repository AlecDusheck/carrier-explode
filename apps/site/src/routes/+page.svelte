<script lang="ts">
  import { listPath, RELEASE_PLATFORMS } from "@carrier-explode/schema/types";
  import { deviceWords } from "#lib/feature-pages.ts";
  import { buildsHref, link } from "#lib/format.ts";
  import type { NewsItem } from "#lib/server/news.ts";
  import RecentChanges from "#lib/components/RecentChanges.svelte";

  let { data } = $props();
</script>

{#snippet item(n: NewsItem)}
  <p class="prose">
    {#if n.link}
      {@const at = n.text.indexOf(n.link.text)}
      {n.text.slice(0, at)}<a href={n.link.href}>{n.link.text}</a>{n.text.slice(at + n.link.text.length)}
    {:else}
      {n.text}
    {/if}
  </p>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <div class="home">
      <div>
        {#if data.news.length}
          <fieldset class="hgroup">
            <legend>News</legend>
            {#each data.news as n (n.text)}{@render item(n)}{/each}
          </fieldset>
        {/if}
        <fieldset class="hgroup">
          <legend>About</legend>
          <p class="prose">Carrier settings from {deviceWords(RELEASE_PLATFORMS, "and")} firmware, decoded and compared.</p>
          <p class="prose">
            Look up a <a href={link(listPath(RELEASE_PLATFORMS[0], "carrier"))}>carrier</a>'s APNs, VoLTE, Wi-Fi Calling and 5G on each phone.
            Pick the <a href={link("/features")}>features</a> you need and see which carriers have them.
            <a href={link("/compare")}>Compare</a> any two versions or carriers, and see what each <a href={buildsHref(RELEASE_PLATFORMS[0])}>build</a> changed.
          </p>
          <p class="prose">
            Get it all as JSON from the <a href={link("/wiki/api")}>API</a>, or as a daily CC0 <a href={link("/wiki/datasets")}>dataset</a>. The <a href={link("/wiki")}>wiki</a> explains each format.
          </p>
        </fieldset>
      </div>
      <RecentChanges />
    </div>
  </div>
</div>

<style>
  .home {
    display: grid;
    gap: 0 12px;
    align-items: start;
    max-width: 1100px;
  }
  @media (min-width: 761px) {
    .home {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .home :global(fieldset.hgroup) {
    margin: 0 0 10px;
  }
</style>
