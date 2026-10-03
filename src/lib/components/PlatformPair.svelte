<script lang="ts">
  import { page } from "$app/state";
  import { getPair } from "#lib/api/bundles.remote.ts";
  import { FEATURES } from "#lib/features.ts";
  import { compareHref, conceptText, link, withParams } from "#lib/format.ts";
  import { sourcePath } from "#lib/schema/types.ts";
  import type { At } from "#lib/types.ts";
  import FeatureStatus from "./features/FeatureStatus.svelte";
  import PhonePicker from "./PhonePicker.svelte";

  /** The Overview's one cross-platform section: this carrier's feature states on a chosen iPhone and a chosen Pixel. */
  let { at }: { at: At } = $props();

  const sp = $derived(page.url.searchParams);
  const pair = $derived(await getPair({
    source: at.source,
    ...(sp.get("iphone") ? { apple: sp.get("iphone") ?? undefined } : {}),
    ...(sp.get("pixel") ? { android: sp.get("pixel") ?? undefined } : {}),
  }));
</script>

{#if pair}
  {@const sides = [pair.apple, pair.android] as const}
  <fieldset class="hgroup" id="platforms">
    <legend>iOS and Android</legend>
    <p class="dimtext note">
      <a href={link(sourcePath(pair.apple.source))}>{pair.apple.source.name}</a> for {pair.apple.readFor} against
      <a href={link(sourcePath(pair.android.source))}>{pair.android.source.name}</a> for {pair.android.readFor}.
      <a href={compareHref({ source: pair.apple.source, slug: pair.apple.version.slug }, { source: pair.android.source, slug: pair.android.version.slug, line: pair.android.phone?.id })}>Compare every setting</a>
    </p>
    <div class="rowflex">
      {#each sides as side, i (i)}
        <PhonePicker
          platform={side.source.platform}
          choices={side.phones.map((p) => ({ key: p.id, label: p.name, id: p.id, name: p.name, href: withParams(page.url, { [i ? "pixel" : "iphone"]: p.id }) + "#platforms" }))}
          selected={side.phone?.id}
        />
      {/each}
    </div>
    <table class="grid">
      <thead><tr><th>Feature</th><th>{pair.apple.readFor}</th><th>{pair.android.readFor}</th></tr></thead>
      <tbody>
        {#each FEATURES.filter((f) => f.slug in pair.apple.states || f.slug in pair.android.states) as f (f.slug)}
          <tr>
            <td class="k">{f.name}</td>
            {#each sides as side, i (i)}
              <td>
                <FeatureStatus state={side.states[f.slug] ?? "unknown"} />
                {#each side.spread[f.slug] ?? [] as s (s.state)}<div class="dimtext">{s.state}: {s.phones.join(", ")}</div>{/each}
              </td>
            {/each}
          </tr>
        {/each}
        {#each pair.headline as r (r.id)}
          <tr>
            <td class="k">{r.name}</td>
            <td class="mono wrap">{conceptText(r.a)}</td>
            <td class="mono wrap">{conceptText(r.b)}{#if r.same}<span class="dimtext"> (same)</span>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
