<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getComparison, getPhoneChanges } from "#lib/api/ios.remote.ts";
  import { routineReason } from "#lib/changes.ts";
  import { compareHref, nativeHref, withParams } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Pane from "../../Pane.svelte";
  import VersionPicker from "../../VersionPicker.svelte";
  import BundleCompare from "../BundleCompare.svelte";
  import PhoneChanges from "../PhoneChanges.svelte";

  let { at }: TabProps = $props();

  const sp = $derived(page.url.searchParams);
  const against = $derived(sp.get("against"));
  const file = $derived(sp.get("file"));
  const bundle = $derived(await getBundle({ source: at.source, slug: at.version }));
  const chosen = $derived(against ?? bundle.previous?.slug ?? "");

  /** The timeline runs newest first, so a version at a higher index is older. */
  const isOlder = (x: string, y: string): boolean =>
    bundle.timeline.findIndex((t) => t.slug === x) >= bundle.timeline.findIndex((t) => t.slug === y);
</script>

<div class="rowflex">
  <VersionPicker
    label="Compare against"
    platform="ios"
    timeline={bundle.timeline.filter((t) => t.slug !== at.version)}
    current={chosen}
    head={bundle.head}
    href={(slug) => withParams(page.url, { against: slug === bundle.previous?.slug ? null : slug })}
  />
  <a href={compareHref({ source: at.source, slug: chosen || undefined }, { source: at.source, slug: at.version }, file)}>Compare with another source…</a>
</div>

<Pane>
  {@const cmp = await getComparison({
    a: against ? { source: at.source, slug: against } : null,
    b: { source: at.source, slug: at.version },
    ...(file ? { path: file } : {}),
  })}
  {#if !cmp.a || !cmp.diff}
    <p class="dimtext">Nothing older to compare against.</p>
  {:else}
    {@const older = isOlder(cmp.a.entry.slug, cmp.b.entry.slug)}
    {#if file}
      <div class="filters gap-above">
        <span class="mono breakall">{file}</span>
        <a href={withParams(page.url, { file: null })}>Whole bundle</a>
      </div>
    {:else}
      {#if !cmp.diff.files.some((f) => !routineReason(f, true))}
        <p class="note"><b>No change</b> in carrier.plist or any other file every phone reads.</p>
      {/if}
      {@const phones = await getPhoneChanges({ source: at.source, slug: at.version, ...(against ? { against } : {}) })}
      {#if phones?.length}<PhoneChanges changes={phones} />{/if}
    {/if}
    <BundleCompare
      diff={cmp.diff}
      fileHref={(side, path) => nativeHref(at.place, at.ref, side === "a" ? (cmp.a?.entry.slug ?? at.version) : at.version, "files", path)}
      left={older ? "Before" : "Other"}
      right={older ? "After" : "This"}
      narrowHref={(path) => withParams(page.url, { file: path })}
      routine={file ? undefined : (f) => routineReason(f, true)}
    />
  {/if}
</Pane>
