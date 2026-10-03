<script lang="ts">
  import { page } from "$app/state";
  import { getCarrierFeatures, getFeaturePhones, getFeatureSummary, getIndex, getVisitorCountry, guessCarrierName } from "#lib/api/bundles.remote.ts";
  import { FEATURES, featureBySlug } from "#lib/features.ts";
  import { link, withParams } from "#lib/format.ts";
  import { carrierName } from "#lib/names.ts";
  import Pane from "#lib/components/Pane.svelte";
  import CarrierList from "#lib/components/features/CarrierList.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  // Links between the feature pages keep the phone and carrier picked.
  const featureHref = (slug: string) => link(`/features/${slug}`) + page.url.search;
  const carrierHref = (name: string) => withParams(page.url, { carrier: name });
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
        {@const picked = page.url.searchParams.get("carrier")}
        {@const carrier = picked ?? (await guessCarrierName())}
        <FeaturePhonePicker {phones} {phone} />

        {#if phone && carrier}
          {@const mine = await getCarrierFeatures({ name: carrier, phone: phone.id })}
          <h2>{carrierName(carrier).brand} on the {phone.name}</h2>
          {#if !picked}<p class="dimtext">Guessed from the network you are on. Not yours? Find it below.</p>{/if}
          {#if mine}
            <table class="grid">
              <tbody>
                {#each mine as m (m.slug)}
                  <tr><td><a href={featureHref(m.slug)}>{featureBySlug(m.slug)?.name}</a></td><td><FeatureStatus state={m.state} /></td></tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="dimtext">No feature data for this carrier yet.</p>
          {/if}
        {/if}

        <h2>{carrier ? "Another carrier" : "Find your carrier"}</h2>
        <CarrierList rows={(await getIndex()).carriers} home={await getVisitorCountry()} href={carrierHref} />

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
