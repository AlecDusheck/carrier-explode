<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { getBundle } from "$lib/api/bundles.remote";
  import { bundleArgs, bundleHref } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import VersionTimeline from "$lib/components/VersionTimeline.svelte";

  type Bundle = Awaited<ReturnType<typeof getBundle>>;

  let { params, children } = $props();

  const args = $derived(bundleArgs({ ...params, version: page.params.version }));

  // Switching version keeps the tab, but not the file or query within it.
  const tab = $derived(/^\/[^/]+\/[^/]+\/[^/]+\/([^/]+)/.exec(page.url.pathname)?.[1]);
</script>

{#snippet withBundle(body: Snippet<[Bundle]>)}
  <Pane quiet>{@render body(await getBundle(args))}</Pane>
{/snippet}

{#snippet ident(bundle: Bundle)}
  {#if bundle.related.country}
    <a href={bundleHref("countries", bundle.related.country)}>{bundle.related.country} country bundle</a>
  {:else if bundle.countryName}
    <span class="dimtext">{bundle.countryName}</span>
  {:else if bundle.cc}
    <span class="dimtext">{bundle.cc.toUpperCase()}</span>
  {/if}
  {#if bundle.related.carriers.length}
    <a href="#carriers">{bundle.related.carriers.length} carriers</a>
  {/if}
{/snippet}

{#snippet versions(bundle: Bundle)}
  <VersionTimeline
    timeline={bundle.timeline}
    current={bundle.entry.slug}
    href={(slug) => bundleHref(bundle.kind, bundle.name, slug, tab)}
  />
{/snippet}

{#snippet tabs(bundle: Bundle)}
  {@const files = bundle.info.files}
  {@const pri = files.filter((f) => f.kind === "pri-der" || f.kind === "pri-plain").length}
  {@const images = files.filter((f) => f.kind === "image").length}
  {@const items = [
    ["", "Summary"],
    ...("carrier.plist" in bundle.quick ? [["plist", "carrier.plist"]] : []),
    ...(pri ? [["baseband", `Baseband (${pri})`]] : bundle.kind === "carriers" ? [["baseband", "Baseband"]] : []),
    ["files", `Files (${files.length})`],
    ...(images ? [["assets", `Assets (${images})`]] : []),
    ...(bundle.info.locales.length ? [["strings", `Strings (${bundle.info.locales.length})`]] : []),
    ...(bundle.previous ? [["changes", "Changes"]] : []),
  ]}
  {#each items as [seg, label] (seg)}
    <a href={bundleHref(bundle.kind, bundle.name, bundle.entry.slug, seg)} aria-current={(tab ?? "") === seg ? "page" : undefined}>{label}</a>
  {/each}
{/snippet}

<!-- Name, version strip and tab row keep their height while the bundle loads, so the pane below never jumps. -->
<div class="bundle-head">
  <div class="ident"><b>{params.name}</b>{@render withBundle(ident)}</div>
  <div class="versions-slot">{@render withBundle(versions)}</div>
</div>
<nav class="tabs tabs-slot">{@render withBundle(tabs)}</nav>

{@render children()}
