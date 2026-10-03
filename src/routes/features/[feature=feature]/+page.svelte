<script lang="ts">
  import { page } from "$app/state";
  import { getFeaturePhones, getFeatureTable, getVisitorCountry } from "#lib/api/bundles.remote.ts";
  import { FEATURES, featureBySlug } from "#lib/features.ts";
  import { link } from "#lib/format.ts";
  import { carrierName, countryName } from "#lib/names.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  let { params } = $props();

  const feature = $derived(featureBySlug(params.feature)!);
  let filter = $state("");
  let offeredOnly = $state(true);

  const FAQ = $derived([
    {
      q: `Why does ${feature.name} depend on my iPhone?`,
      a: "Carriers ship settings for each iPhone model separately. The same carrier can offer a feature on newer iPhones and not on older ones, or the other way round.",
    },
    {
      q: "Where do these answers come from?",
      a: "From the carrier settings Apple publishes for each carrier, read for each iPhone model. Some features also need your plan to include them; those show as available.",
    },
  ]);

  const jsonLd = $derived(JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "iPhone carrier features", item: `${page.url.origin}/features` },
        { "@type": "ListItem", position: 2, name: feature.name, item: page.url.origin + page.url.pathname },
      ],
    },
  ]).replace(/</g, "\\u003c"));

  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const offers = (state: string) => state === "on" || state === "available";
</script>

<svelte:head>
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<div class="view">
  <div class="scroll pad">
    <article class="consumer">
      <p class="crumbs"><a href={link("/features")}>iPhone carrier features</a></p>
      <h1>{feature.name} on iPhone</h1>
      <p class="lead">{feature.what}</p>
      {#if feature.where}<p>Where to turn it on: <b>{feature.where}</b>.</p>{/if}

      <Pane>
        {@const phones = await getFeaturePhones()}
        {@const phone = phones.find((p) => p.id === page.url.searchParams.get("phone")) ?? phones[0]}
        <p>Whether you get it depends on your carrier and your iPhone model.</p>
        <FeaturePhonePicker {phones} {phone} />
        {#if phone}
          {@const t = await getFeatureTable({ slug: feature.slug, phone: phone.id })}
          {#if !t.indexed}
            <p class="dimtext note">Not computed yet: the next index run reads every carrier.</p>
          {:else}
            {@const offered = t.rows.filter((r) => offers(r.state)).length}
            {@const notOffered = t.rows.filter((r) => r.state === "no").length}
            {@const unknown = t.rows.length - offered - notOffered}
            <p class="answer"><b>{offered} carrier{offered === 1 ? "" : "s"}</b> offer {feature.name} on {phone.name}.</p>
            <p class="dimtext">
              {notOffered} don't.{#if unknown} For {unknown} more there are no settings for the {phone.name} to read yet.{/if}
            </p>

            {@const home = await getVisitorCountry()}
            {@const f = fold(filter)}
            {@const rows = t.rows
              .filter((r) => !offeredOnly || offers(r.state))
              .map((r) => ({ ...r, brand: carrierName(r.name).brand, country: countryName(r.cc) }))
              .filter((r) => !f || fold(r.brand).includes(f) || fold(r.name).includes(f) || fold(r.country ?? "").includes(f))
              .sort((a, b) =>
                Number(b.cc === home) - Number(a.cc === home) ||
                Number(!a.country) - Number(!b.country) ||
                (a.country ?? "").localeCompare(b.country ?? "") ||
                a.brand.localeCompare(b.brand))}
            {@const shared = new Set(rows.filter((r, i) => rows.findIndex((o) => o.brand === r.brand && o.cc === r.cc) !== i).map((r) => r.brand))}
            <div class="filters">
              <input class="grow" type="search" name="carrier" placeholder="Find your carrier or country" aria-label="find your carrier or country" bind:value={filter} />
              <label class="lbl"><input type="checkbox" bind:checked={offeredOnly} /> Only carriers that offer it</label>
            </div>
            <table class="grid">
              <thead><tr><th>Carrier</th><th>{feature.name}</th></tr></thead>
              <tbody>
                {#each rows as r, i (r.name)}
                  {#if i === 0 || rows[i - 1].country !== r.country}
                    <tr class="group"><td colspan="2">{r.country ?? "Other"}</td></tr>
                  {/if}
                  <tr>
                    <td><a href={link(`/carriers/${encodeURIComponent(r.name)}/settings`)}>{r.brand}</a>
                      {#if shared.has(r.brand)}<span class="dimtext">{r.display}</span>{/if}</td>
                    <td><FeatureStatus state={r.state} /></td>
                  </tr>
                {:else}
                  <tr><td colspan="2" class="dimtext">No carrier matches.</td></tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
      </Pane>

      <h2>Questions</h2>
      {#each FAQ as x (x.q)}
        <h3>{x.q}</h3>
        <p>{x.a}</p>
      {/each}

      <h2>Other features</h2>
      <ul class="others">
        {#each FEATURES.filter((x) => x.slug !== feature.slug) as x (x.slug)}
          <li><a href={link(`/features/${x.slug}`) + page.url.search}>{x.name}</a></li>
        {/each}
      </ul>
    </article>
  </div>
</div>
