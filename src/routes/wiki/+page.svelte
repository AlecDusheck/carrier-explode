<script lang="ts">
  import { link } from "#lib/format.ts";
  import { CARRIERS, TOPICS, type Article } from "#lib/wiki.ts";
</script>

{#snippet list(articles: Article[])}
  <table>
    <thead><tr><th>Article</th><th>Covers</th></tr></thead>
    <tbody>
      {#each articles as a (a.slug)}
        <tr><td><a href={link(`/wiki/${a.slug}`)}>{a.title}</a></td><td>{a.description}</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<h1>Wiki</h1>
<p>Notes on iOS carrier bundles: what is in them, how iOS picks one, how they are delivered and signed, and what the modem files inside them do. Written from the bundles this site holds, and where a number can be read from them, read live.</p>
{@render list(TOPICS)}
{#if CARRIERS.length}
  <h2>Carriers</h2>
  <p>What is unusual about the bundles of some of the larger carriers.</p>
  {@render list(CARRIERS)}
{/if}
