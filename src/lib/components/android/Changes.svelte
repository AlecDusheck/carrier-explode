<script lang="ts">
  import { page } from "$app/state";
  import { getAndroidChanges } from "#lib/api/android.remote.ts";
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { compareHref, verArgs, withParams } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import DiffRows from "../DiffRows.svelte";
  import Pane from "../Pane.svelte";
  import VersionPicker from "../VersionPicker.svelte";

  let { at }: TabProps = $props();

  const against = $derived(page.url.searchParams.get("against"));
  const head = $derived(await getBundleHead(verArgs(at)));
  const chosen = $derived(against ?? head.previous?.slug ?? "");
</script>

<div class="rowflex">
  <VersionPicker
    label="Compare against"
    timeline={head.timeline.filter((t) => t.slug !== at.version)}
    current={chosen}
    head={head.head}
    href={(slug) => withParams(page.url, { against: slug === head.previous?.slug ? null : slug })}
  />
  <a href={compareHref({ source: at.ref, slug: chosen || undefined, line: at.line }, { source: at.ref, slug: at.version, line: at.line })}>Compare with another source…</a>
</div>

<Pane>
  {@const c = await getAndroidChanges({ ...verArgs(at), ...(against ? { against } : {}) })}
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
