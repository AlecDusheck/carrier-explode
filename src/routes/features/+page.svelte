<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getCarrierFeatures, getFeaturePhones, getFeatureSummary, getIndex } from "#lib/api/bundles.remote.ts";
  import { FEATURES, featureBySlug } from "#lib/features.ts";
  import { link, withParams } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FeatureStatus from "#lib/components/features/FeatureStatus.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  const carrierParam = $derived(page.url.searchParams.get("carrier"));
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
        <div class="filters">
          <label class="lbl grow">
            Carrier
            <select name="carrier" value={carrierParam ?? ""} onchange={(e) => goto(withParams(page.url, { carrier: e.currentTarget.value || null }), { replace: true, reset: false })}>
              <option value="">Pick your carrier</option>
              {#each carriers as c (c.name)}<option value={c.name}>{c.display}{c.cc ? ` (${c.cc.toUpperCase()})` : ""}</option>{/each}
            </select>
          </label>
        </div>
        {#if phone && carrierParam}
          {@const mine = await getCarrierFeatures({ name: carrierParam, phone: phone.id })}
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
                <span class="dimtext">Offered by {s.counts.on + s.counts.available} of {s.of - s.counts.unknown} carriers on {phone.name}.</span>
              {/if}
            </li>
          {/each}
        </ul>
      </Pane>
    </article>
  </div>
</div>
