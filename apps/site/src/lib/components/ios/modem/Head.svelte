<script lang="ts">
  import { getBaseband, getModemPackages } from "#lib/api/apple.remote.ts";
  import { getBuilds } from "#lib/api/builds.remote.ts";
  import { buildHref, modemHref } from "#lib/format.ts";
  import { isTextFile, modemCapabilities } from "@carrier-explode/decode-ios";
  import type { ModemTab } from "../../../../params.ts";
  import type { ModemProps } from "../../views.ts";
  import BuildPicker from "../../BuildPicker.svelte";
  import Pane from "../../Pane.svelte";
  import TabLinks from "../../TabLinks.svelte";
  import ModemPicker from "../baseband/ModemPicker.svelte";

  /** An iOS modem package's head, laid out as a bundle's: the package in place of the name, the iOS version in place of the bundle's. */
  let { build, modem, tab }: ModemProps & { tab: ModemTab | "" } = $props();

  // Packages with plaintext defaults have the tabs; the others are a firmware summary.
  const plaintext = $derived(!!modemCapabilities(modem)?.plaintextDefaults);
  const href = (t?: string): string => modemHref("ios", build, modem, t);
</script>

<div class="bundle-head">
  <div class="ident">
    <Pane quiet><ModemPicker mods={await getModemPackages(build)} {modem} {tab} /></Pane>
  </div>
  <div class="versions-slot">
    <Pane quiet>
      <BuildPicker
        builds={(await getBuilds()).filter((b) => b.platform === "ios" && (b.modemFamilies.length > 0 || b.id === build))}
        current={build}
        href={(b) => (b.modemFamilies.some((f) => f.code === modem) ? modemHref("ios", b.id, modem, tab) : buildHref("ios", b.id))}
      />
    </Pane>
  </div>
</div>
{#if plaintext}
  <nav class="tabs-slot">
    <Pane quiet>
      {@const bb = await getBaseband({ build, family: modem })}
      {@const items: Array<[string, string]> = [
        [href(), "Overview"],
        [href("carriers"), "Carriers"],
        [href("policy"), `Policy files (${bb.files.filter(isTextFile).length})`],
        ...(bb.mdb ? [[href("networks"), "Network databases"] as [string, string]] : []),
        [href("configs"), "Configs"],
        [href("changes"), "Changes"],
      ]}
      <TabLinks {items} />
    </Pane>
  </nav>
{/if}
