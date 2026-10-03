<script lang="ts">
  import { page } from "$app/state";
  import { getFeaturePhones, getFeatureTable, getVisitorCountry, guessCarrierName } from "#lib/api/bundles.remote.ts";
  import { FEATURES, featureBySlug } from "#lib/features.ts";
  import { bundleHref, link } from "#lib/format.ts";
  import { carrierName } from "#lib/names.ts";
  import Pane from "#lib/components/Pane.svelte";
  import CarrierList from "#lib/components/features/CarrierList.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  let { params } = $props();

  const feature = $derived(featureBySlug(params.feature)!);
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
        {@const carrier = await guessCarrierName()}
        {#if phone}
          {@const t = await getFeatureTable({ slug: feature.slug, phone: phone.id })}
          {#if !t.indexed}
            <p class="dimtext note">Not computed yet: the next index run reads every carrier.</p>
          {:else}
            {@const mine = carrier ? t.rows.find((r) => r.name === carrier) : undefined}
            {#if mine}
              <p class="answer">
                {carrierName(mine.name).brand} on the {phone.name}: <FeatureStatus state={mine.state} />
              </p>
              <p class="dimtext">Guessed from the network you are on. Not yours? Find it below.</p>
            {/if}

            {@const offered = t.rows.filter((r) => offers(r.state)).length}
            {@const notOffered = t.rows.filter((r) => r.state === "no").length}
            {@const unknown = t.rows.length - offered - notOffered}
            <h2>Carriers</h2>
            <p>
              <b>{offered} carrier{offered === 1 ? "" : "s"}</b> offer {feature.name} on the {phone.name}, and {notOffered} don't.
              {#if unknown}<span class="dimtext">For {unknown} more there are no settings for the {phone.name} to read yet.</span>{/if}
            </p>
            <CarrierList
              rows={offeredOnly ? t.rows.filter((r) => offers(r.state)) : t.rows}
              home={await getVisitorCountry()}
              href={(name) => bundleHref("carriers", name)}
              column={feature.name}
            >
              {#snippet filters()}
                <label class="lbl"><input type="checkbox" bind:checked={offeredOnly} /> Only carriers that offer it</label>
              {/snippet}
            </CarrierList>
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
