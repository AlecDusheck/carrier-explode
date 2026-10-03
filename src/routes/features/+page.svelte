<script lang="ts">
  import { page } from "$app/state";
  import { getFeaturePhones, getFeatureSummary } from "#lib/api/bundles.remote.ts";
  import { FEATURES } from "#lib/features.ts";
  import { link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  // Links to the feature pages keep the phone picked.
  const featureHref = (slug: string) => link(`/features/${slug}`) + page.url.search;
</script>

<div class="view">
  <div class="scroll pad">
    <article class="consumer">
      <h1>iPhone carrier features</h1>
      <p class="lead">What your carrier supports on your iPhone.</p>

      <Pane>
        {@const phones = await getFeaturePhones()}
        {@const phone = phones.find((p) => p.id === page.url.searchParams.get("phone")) ?? phones[0]}
        <FeaturePhonePicker {phones} {phone} />

        {@const summary = phone ? await getFeatureSummary(phone.id) : null}
        <ul class="features">
          {#each FEATURES as f (f.slug)}
            {@const s = summary?.find((x) => x.slug === f.slug)}
            <li>
              <a href={featureHref(f.slug)}><b>{f.name}</b></a>
              <span>{f.what}</span>
              {#if s && phone}
                <span class="dimtext">
                  {s.unusable ? `Not on the ${phone.name}: it has no 5G modem.` : `${s.counts.on + s.counts.available} carriers offer it on the ${phone.name}.`}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </Pane>
    </article>
  </div>
</div>
