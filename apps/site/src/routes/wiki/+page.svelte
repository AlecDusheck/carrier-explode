<script lang="ts">
  import { link } from "#lib/format.ts";
  import { SECTION_ARTICLES, type Article } from "#lib/wiki.ts";
</script>

{#snippet list(articles: Article[])}
  <table>
    <thead><tr><th>Article</th><th>Covers</th></tr></thead>
    <tbody>
      {#each articles as a (a.path)}
        <tr><td><a href={link(`/wiki/${a.path}`)}>{a.title}</a></td><td>{a.description}</td></tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<h1>Wiki</h1>
{#each SECTION_ARTICLES as { section, topics, carriers } (section.id)}
  <h2 id={section.id}>{section.title}</h2>
  <p>{section.intro}</p>
  {@render list(topics)}
  {#if carriers.length}
    <h3>Carriers</h3>
    <p>What is unusual in the settings of some of the larger carriers.</p>
    {@render list(carriers)}
  {/if}
{/each}
