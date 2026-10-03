<script lang="ts">
  import { page } from "$app/state";
  import { getVersions } from "#lib/api/catalog.remote.ts";
  import { nativeHref, placeHref } from "#lib/format.ts";
  import { PLATFORM_NAMES, refOf } from "#lib/places.ts";
  import { sourceKey } from "#lib/schema/types.ts";
  import type { NativeAt } from "#lib/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  let { params, children } = $props();

  const place = $derived({ group: params.group, id: params.id });
  const ref = $derived(refOf(params.group, params.platform, params.source));
  const source = $derived(sourceKey(ref));
  const version = $derived(page.params.version);
  const at = $derived<NativeAt | null>(version ? { place, ref, source, version } : null);
  // Switching version keeps the tab, but not the file or query within it.
  const tab = $derived(page.params.tab ?? "");
  const Tabs = $derived(VIEWS[params.platform].Tabs);
</script>

<!-- Name, version strip and tab row keep their height while the version loads, so the pane below never jumps. -->
<div class="bundle-head">
  <div class="ident">
    <a href={placeHref(place)} title="All of {params.id}">
      <SourceIcon name={ref.name} bundle={params.platform === "ios" && ref.kind === "carrier" ? ref.name : undefined} />
    </a>
    <b>{ref.name}</b>
    <span class="dimtext">{PLATFORM_NAMES[params.platform]}{ref.family ? ` · ${ref.family}` : ""}</span>
  </div>
  {#if at}
    <div class="versions-slot">
      <Pane quiet>
        {@const v = await getVersions({ source, slug: at.version })}
        <VersionPicker platform={params.platform} timeline={v.timeline} current={v.entry.slug} head={v.head} href={(slug) => nativeHref(place, ref, slug, tab || undefined)} />
      </Pane>
    </div>
  {/if}
</div>
{#if at}
  <nav class="tabs tabs-slot"><Pane quiet><Tabs {at} {tab} /></Pane></nav>
{/if}

{@render children()}
