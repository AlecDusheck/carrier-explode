<script lang="ts">
  import { page } from "$app/state";
  import { getAndroid, getAndroidChanges } from "#lib/api/android.remote.ts";
  import { compareHref, withParams } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import DiffRows from "../DiffRows.svelte";
  import Pane from "../Pane.svelte";
  import VersionPicker from "../VersionPicker.svelte";

  let { at }: TabProps = $props();

  const against = $derived(page.url.searchParams.get("against"));
  const v = $derived(await getAndroid({ source: at.source, slug: at.version }));
  const chosen = $derived(against ?? v.previous?.slug ?? "");
</script>

<div class="rowflex">
  <VersionPicker
    label="Compare against"
    platform="android"
    timeline={v.timeline.filter((t) => t.slug !== at.version)}
    current={chosen}
    head={v.head}
    href={(slug) => withParams(page.url, { against: slug === v.previous?.slug ? null : slug })}
  />
  <a href={compareHref({ source: at.source, slug: chosen || undefined }, { source: at.source, slug: at.version })}>Compare with another source…</a>
</div>

<Pane>
  {@const c = await getAndroidChanges({ source: at.source, slug: at.version, ...(against ? { against } : {}) })}
  {#if !c.a}
    <p class="dimtext">Nothing older to compare against.</p>
  {:else}
    <fieldset class="hgroup">
      <legend>Config keys: {c.configs.counts.changed} changed, {c.configs.counts.added} added, {c.configs.counts.removed} removed</legend>
      {#if c.configs.rows.length}<DiffRows rows={[...c.configs.rows]} head="Key" />{:else}<p class="dimtext note">No change.</p>{/if}
    </fieldset>
    <fieldset class="hgroup">
      <legend>APNs</legend>
      {#if c.apns.rows.length}<DiffRows rows={[...c.apns.rows]} head="APN field" />{:else}<p class="dimtext note">No change.</p>{/if}
    </fieldset>
  {/if}
</Pane>
