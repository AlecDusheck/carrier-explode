<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getCarrierFeatures, getFeaturePhones, getFeatureSummary, getIndex, getVisitorCountry, guessCarrierName } from "#lib/api/bundles.remote.ts";
  import { FEATURES, featureBySlug } from "#lib/features.ts";
  import { link, withParams } from "#lib/format.ts";
  import { carrierName, countryName } from "#lib/names.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  const carrierParam = $derived(page.url.searchParams.get("carrier"));

  /** Carriers as option groups by country, the visitor's own country first. */
  function byCountry(carriers: Array<{ name: string; cc?: string }>, home: string | null) {
    const groups = new Map<string, Array<{ name: string; brand: string }>>();
    for (const c of carriers) {
      const country = countryName(c.cc) ?? "Other";
      groups.set(country, [...(groups.get(country) ?? []), { name: c.name, brand: carrierName(c.name).brand }]);
    }
    const first = countryName(home ?? undefined);
    return [...groups]
      .map(([country, list]) => ({ country, list: list.sort((a, b) => a.brand.localeCompare(b.brand)) }))
      .sort((a, b) =>
        Number(b.country === first) - Number(a.country === first) ||
        Number(a.country === "Other") - Number(b.country === "Other") ||
        a.country.localeCompare(b.country));
  }
  const featureHref = (slug: string) => link(`/features/${slug}`) + (page.url.searchParams.has("phone") ? `?phone=${page.url.searchParams.get("phone")}` : "");
</script>

<div class="view">
  <div class="scroll pad">
    <article class="consumer">
      <h1>iPhone carrier features</h1>
      <p class="lead">
        Whether 5G Standalone, Wi-Fi Calling, RCS or satellite texting works on your iPhone depends on your carrier and on
        your iPhone model, and sometimes on your plan. These answers come from the carrier settings Apple ships for each
        carrier, read separately for each iPhone.
      </p>

      <Pane>
        {@const phones = await getFeaturePhones()}
        {@const phone = phones.find((p) => p.id === page.url.searchParams.get("phone")) ?? phones[0]}
        <FeaturePhonePicker {phones} {phone} />

        <h2>Check your carrier</h2>
        {@const carriers = (await getIndex()).carriers}
        {@const carrier = carrierParam ?? (await guessCarrierName())}
        <div class="filters">
          <label class="lbl grow">
            Carrier
            <select name="carrier" value={carrier ?? ""} onchange={(e) => goto(withParams(page.url, { carrier: e.currentTarget.value || null }), { replace: true, reset: false })}>
              <option value="">Pick your carrier</option>
              {#each byCountry(carriers, await getVisitorCountry()) as g (g.country)}
                <optgroup label={g.country}>
                  {#each g.list as c (c.name)}<option value={c.name}>{c.brand}</option>{/each}
                </optgroup>
              {/each}
            </select>
          </label>
        </div>
        {#if phone && carrier}
          {@const mine = await getCarrierFeatures({ name: carrier, phone: phone.id })}
          {#if mine}
            <table class="grid">
              <thead><tr><th>Feature</th><th>On {phone.name}</th></tr></thead>
              <tbody>
                {#each mine as m (m.slug)}
                  <tr><td><a href={featureHref(m.slug)}>{featureBySlug(m.slug)?.name}</a></td><td><FeatureStatus state={m.state} /></td></tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="dimtext note">No feature data for this carrier yet.</p>
          {/if}
        {/if}

        <h2>Features</h2>
        {@const summary = phone ? await getFeatureSummary(phone.id) : null}
        <ul class="features">
          {#each FEATURES as f (f.slug)}
            {@const s = summary?.find((x) => x.slug === f.slug)}
            <li>
              <a href={featureHref(f.slug)}><b>{f.name}</b></a>
              <span>{f.what}</span>
              {#if s && phone}
                <span class="dimtext">{s.counts.on + s.counts.available} carriers offer it on the {phone.name}.</span>
              {/if}
            </li>
          {/each}
        </ul>
      </Pane>
    </article>
  </div>
</div>
