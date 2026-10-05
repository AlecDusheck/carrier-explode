<script lang="ts">
  import { page } from "$app/state";
  import Pane from "#lib/components/Pane.svelte";

  let { data } = $props();
  const Body = $derived(data.article.Body);
  const section = $derived(data.article.section);
  // "2 October 2026": unambiguous wherever the reader is.
  const updated = $derived(new Date(data.article.updated + "T00:00:00Z")
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));

  // Search engines and agents read this rather than guess from the markup.
  const jsonLd = $derived(JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: data.article.title,
      description: data.article.description,
      dateModified: data.article.updated,
      author: data.article.contributors.map((c) => ({ "@type": "Person", name: c.name, url: c.url })),
      url: page.url.origin + page.url.pathname,
      about: section?.about,
      isPartOf: { "@type": "WebSite", name: "carrier-explode", url: page.url.origin },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { name: "Wiki", item: `${page.url.origin}/wiki` },
        ...(section ? [{ name: section.title, item: `${page.url.origin}/wiki#${section.id}` }] : []),
        { name: data.article.title, item: page.url.origin + page.url.pathname },
      ].map((crumb, i) => ({ "@type": "ListItem", position: i + 1, ...crumb })),
    },
  ]).replace(/</g, "\\u003c"));
</script>

<svelte:head>
  <meta property="og:type" content="article" />
  <meta property="article:modified_time" content={data.article.updated} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<h1>{data.article.title}</h1>
<!-- Articles read live data (bundle versions, setting counts); this is where they wait. -->
<Pane>
  <Body />
</Pane>

<footer class="wiki-meta">
  <p>
    Last updated <time datetime={data.article.updated}>{updated}</time>.
    Contributors:
    {#each data.article.contributors as c, i (c.name)}{i ? ", " : ""}{#if c.url}<a href={c.url} rel="author">{c.name}</a>{:else}{c.name}{/if}{/each}.
  </p>
</footer>
