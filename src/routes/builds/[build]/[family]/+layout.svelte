<script lang="ts">
  import { page } from "$app/state";
  import { getBaseband, getBasebandBuilds, getModems } from "#lib/api/tables.remote.ts";
  import { modemCapabilities } from "#lib/decode/index.ts";
  import { link, modemHref } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BuildPicker from "#lib/components/BuildPicker.svelte";
  import TabLinks from "#lib/components/TabLinks.svelte";
  import ModemPicker from "#lib/components/baseband/ModemPicker.svelte";

  let { params, children } = $props();

  const tab = $derived(/^\/builds\/[^/]+\/[^/]+\/([^/]+)/.exec(page.url.pathname)?.[1] ?? "");
  // Packages with plaintext defaults have the tabs; the others are a firmware summary.
  const plaintext = $derived(!!modemCapabilities(params.family)?.plaintextDefaults);
</script>

<!-- Laid out as a bundle's page: the modem in place of the name, the iOS version in place of the bundle's. -->
<div class="view">
<div class="bundle-head">
  <div class="ident">
    <Pane quiet><ModemPicker mods={await getModems(params.build)} family={params.family} {tab} /></Pane>
  </div>
  <div class="versions-slot">
    <Pane quiet>
      <BuildPicker
        builds={await getBasebandBuilds()}
        current={params.build}
        href={(b) => (b.families.includes(params.family) ? modemHref(b.build, params.family, tab) : link(`/builds/${b.build}`))}
      />
    </Pane>
  </div>
</div>
{#if plaintext}
  <nav class="tabs tabs-slot">
    <Pane quiet>
      {@const bb = await getBaseband({ build: params.build, family: params.family })}
      {@const items: Array<[string, string]> = [
        [modemHref(params.build, params.family), "Overview"],
        [modemHref(params.build, params.family, "carriers"), "Carriers"],
        [modemHref(params.build, params.family, "policy"), `Policy files (${bb.files.filter((f) => f.readable).length})`],
        ...(bb.mdb ? [[modemHref(params.build, params.family, "networks"), "Network databases"] as [string, string]] : []),
        [modemHref(params.build, params.family, "configs"), "Configs"],
        [modemHref(params.build, params.family, "changes"), "Changes"],
      ]}
      <TabLinks {items} current={modemHref(params.build, params.family, tab)} />
    </Pane>
  </nav>
{/if}

{@render children()}
</div>
