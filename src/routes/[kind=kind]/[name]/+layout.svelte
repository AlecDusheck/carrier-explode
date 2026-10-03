<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { getBundle } from "#lib/api/bundles.remote.ts";
  import { bundleArgs, bundleHref } from "#lib/format.ts";
  import { isPri } from "#lib/phones.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BundleIcon from "#lib/components/BundleIcon.svelte";
  import TabLinks from "#lib/components/TabLinks.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  type Bundle = Awaited<ReturnType<typeof getBundle>>;

  let { params, children } = $props();

  const args = $derived(bundleArgs({ ...params, version: page.params.version }));

  // Switching version keeps the tab, but not the file or query within it.
  const tab = $derived(/^\/[^/]+\/[^/]+\/[^/]+\/([^/]+)/.exec(page.url.pathname)?.[1]);
</script>

{#snippet withBundle(body: Snippet<[Bundle]>)}
  <Pane quiet>{@render body(await getBundle(args))}</Pane>
{/snippet}

{#snippet icon(bundle: Bundle)}
  <BundleIcon kind={bundle.kind} name={bundle.name} cc={bundle.cc} />
{/snippet}

{#snippet versions(bundle: Bundle)}
  <VersionPicker
    timeline={bundle.timeline}
    current={bundle.entry.slug}
    head={bundle.head}
    href={(slug) => bundleHref(bundle.kind, bundle.name, slug, tab)}
  />
{/snippet}

{#snippet tabs(bundle: Bundle)}
  {@const files = bundle.info.files}
  {@const pri = files.filter(isPri).length}
  {@const hasPlist = "carrier.plist" in bundle.quick}
  {@const items = [
    ["", "Overview"],
    ...(bundle.kind === "countries" && hasPlist && "CellBroadcast" in (bundle.quick["carrier.plist"] as object) ? [["alerts", "Emergency alerts"]] : []),
    ...(hasPlist ? [["settings", "Settings"]] : []),
    ...(pri || bundle.kind === "carriers" ? [["modem", "Modem"]] : []),
    ["files", `Files (${files.length})`],
    ...(bundle.previous ? [["changes", "Changes"]] : []),
  ]}
  <TabLinks
    items={items.map(([seg, label]) => [bundleHref(bundle.kind, bundle.name, bundle.entry.slug, seg), label])}
    current={bundleHref(bundle.kind, bundle.name, bundle.entry.slug, tab ?? "")}
  />
{/snippet}

<!-- Name, version strip and tab row keep their height while the bundle loads, so the pane below never jumps. -->
<div class="bundle-head">
  <div class="ident">
    {@render withBundle(icon)}
    <b>{params.name}</b>
  </div>
  <!-- Emergency alerts come from the current copy whatever the version, so that tab has no strip. -->
  {#if tab !== "alerts"}<div class="versions-slot">{@render withBundle(versions)}</div>{/if}
</div>
<nav class="tabs tabs-slot">{@render withBundle(tabs)}</nav>

{@render children()}
