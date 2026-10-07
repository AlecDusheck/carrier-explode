<script lang="ts">
  import { page } from "$app/state";
  import { jsonLdScript } from "#lib/seo.ts";
  import { getFeaturePhone, getFeaturePhones, getFeatureTable, getVisitorCountry, guessCarrierPages } from "#lib/api/sources.remote.ts";
  import { deviceWords, FEATURE_PAGES } from "#lib/feature-pages.ts";
  import { PLATFORM_DEVICES } from "#lib/platforms.ts";
  import type { ReleasePlatform } from "@carrier-explode/schema/types";
  import { link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import CarrierList from "#lib/components/features/CarrierList.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  let { data } = $props();

  const feature = $derived(data.feature);
  let hideNo = $state(true);

  const SHIPPED = {
    ios: "Apple ships them per iPhone model",
    android: "Google ships them per Pixel",
    samsung: "Samsung ships them per Galaxy firmware",
  } as const satisfies Record<ReleasePlatform, string>;

  const FAQ = $derived([
    {
      q: `Why does ${feature.name} depend on my phone?`,
      a: `Carrier settings differ by phone: ${feature.platforms.map((p) => SHIPPED[p]).join("; ")}. The same carrier can offer a feature on newer phones and not on older ones, or the other way round.`,
    },
    {
      q: "Where do these answers come from?",
      a: `From the carrier settings shipped for each carrier, read for each ${deviceWords(feature.platforms, "and")}. Some features also need your plan to include them; those show as available.`,
    },
  ]);

  const jsonLd = $derived(jsonLdScript([
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Carrier features", item: `${page.url.origin}/features` },
        { "@type": "ListItem", position: 2, name: feature.name, item: page.url.origin + page.url.pathname },
      ],
    },
  ]));

  const offers = (state: string) => state === "on" || state === "available";

  // Guessed after mount, so the server's page reads no visitor and the edge can keep it.
  let mine: readonly string[] = $state([]);
  let home: string | null = $state(null);
  $effect(() => {
    void (async () => {
      [mine, home] = await Promise.all([guessCarrierPages(), getVisitorCountry()]);
    })();
  });
</script>

<svelte:head>
  {@html jsonLd}
</svelte:head>

<div class="view">
  <div class="scroll pad">
    <article class="consumer">
      <p class="crumbs"><a href={link("/features")}>Carrier features</a></p>
      <h1>{feature.name}</h1>
      <p class="lead">{feature.what}</p>

      <Pane>
        {@const phones = (await getFeaturePhones()).filter((p) => feature.platforms.includes(p.platform))}
        {@const phone = await getFeaturePhone({ phone: page.url.searchParams.get("phone") ?? undefined, slug: feature.slug })}
        {@const where = phone ? feature.where[phone.platform] : undefined}
        {#if where}<p>Where to turn it on: <b>{where}</b>.</p>{/if}
        <FeaturePhonePicker {phones} {phone} />
        {#if phone && !feature.platforms.includes(phone.platform)}
          <p class="answer">{feature.name} is not on {PLATFORM_DEVICES[phone.platform]}s: their carrier settings have no switch for it.</p>
        {:else if phone}
          {@const table = await getFeatureTable({ slug: feature.slug, phone: phone.code })}
          {#if table.unusable}
            <p class="answer">The {phone.name} has no 5G modem, so {feature.name} is not available on it with any carrier.</p>
          {:else}
            {@const rows = table.rows}
            {@const yours = rows.find((r) => mine.includes(r.path))}
            {#if yours}
              <p class="answer">
                {yours.brand} on the {phone.name}: <FeatureStatus state={yours.state} defaulted={yours.defaulted} />
              </p>
              <p class="dimtext">Guessed from the network you are on. Not yours? Find it below.</p>
            {/if}

            {@const offered = rows.filter((r) => offers(r.state)).length}
            {@const notOffered = rows.filter((r) => r.state === "no").length}
            {@const unset = rows.filter((r) => r.state === "unset").length}
            {@const unknown = rows.filter((r) => r.state === "unknown").length}
            {@const byDefault = rows.filter((r) => offers(r.state) && r.defaulted?.layer === "default.pb" && r.defaulted.part === "all").length}
            <h2>Carriers</h2>
            <p>
              <b>{offered} carrier{offered === 1 ? "" : "s"}</b> offer {feature.name} on the {phone.name}{#if byDefault}{" "}({byDefault} of them by the build's default){/if}{#if notOffered}, and {notOffered} don't{/if}.
              {#if unset}<span class="dimtext">{unset} leave it unset.</span>{/if}
              {#if unknown}<span class="dimtext">For {unknown} more we don't have the carrier's settings for the {phone.name} yet, so they show as unknown.</span>{/if}
            </p>
            <CarrierList
              rows={hideNo ? rows.filter((r) => r.state !== "no") : rows}
              {home}
              column={feature.name}
            >
              {#snippet filters()}
                {#if notOffered}<label class="lbl"><input type="checkbox" bind:checked={hideNo} /> Hide carriers that don't offer it</label>{/if}
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

      <Pane quiet>
        {@const phone = await getFeaturePhone({ phone: page.url.searchParams.get("phone") ?? undefined, slug: feature.slug })}
        {@const others = FEATURE_PAGES.filter((x) => x.slug !== feature.slug && (!phone || x.platforms.includes(phone.platform)))}
        {#if others.length}
          <h2>Other features</h2>
          <ul class="others">
            {#each others as x (x.slug)}
              <li><a href={link(`/features/${x.slug}`) + page.url.search}>{x.name}</a></li>
            {/each}
          </ul>
        {/if}
      </Pane>
    </article>
  </div>
</div>
