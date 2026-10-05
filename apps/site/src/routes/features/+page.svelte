<script lang="ts">
  import { page } from "$app/state";
  import { getFeaturePhone, getFeaturePhones, getFeatureSummary } from "#lib/api/sources.remote.ts";
  import { FEATURE_PAGES } from "#lib/feature-pages.ts";
  import { link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import FeaturePhonePicker from "#lib/components/features/FeaturePhonePicker.svelte";

  // Links to the feature pages keep the phone picked.
  const featureHref = (slug: string) => link(`/features/${slug}`) + page.url.search;
</script>

<div class="view">
  <div class="scroll pad">
    <article class="consumer">
      <h1>Carrier features</h1>
      <p class="lead">What your carrier supports on your phone.</p>

      <Pane>
        {@const phones = await getFeaturePhones()}
        {@const phone = await getFeaturePhone(page.url.searchParams.get("phone") ?? undefined)}
        <FeaturePhonePicker {phones} {phone} />

        {@const summary = phone ? await getFeatureSummary(phone.code) : null}
        <ul class="features">
          {#each FEATURE_PAGES.filter((f) => !phone || f.platforms.includes(phone.platform)) as f (f.slug)}
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
