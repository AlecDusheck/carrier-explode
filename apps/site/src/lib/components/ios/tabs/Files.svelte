<script lang="ts">
  import { getAppleBundle, getAppleFile, getAppleModemHead } from "#lib/api/apple.remote.ts";
  import { humanBytes, rawHref, verArgs, versionHref } from "#lib/format.ts";
  import { APPLE_DOCS } from "#lib/apple/tree-docs.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { TabProps } from "#lib/types.ts";
  import FileBody from "../FileBody.svelte";
  import DeviceNames from "../DeviceNames.svelte";
  import FileDevices from "../FileDevices.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";
  import FileIcon from "../FileIcon.svelte";

  let { at, path }: TabProps = $props();

  const bundle = $derived(await getAppleBundle(verArgs(at)));
  const file = $derived(path ? await getAppleFile({ ...verArgs(at), path }) : null);
  // A Qualcomm override file reads as its modem configuration, as on the Modem tab.
  const head = $derived(path && (file?.kind === "pri-der" || file?.kind === "tri-der") ? await getAppleModemHead({ ...verArgs(at), path }) : null);
</script>

{#if path && file}
  <div class="filters"><span class="mono breakall">{path}</span></div>
  {#if head}
    <FileDevices devices={file.devices} />
    <ModemConfigView ref={{ kind: "bundle", ...verArgs(at), path }} {head} />
  {:else}
    <FileBody {file} ctx={{ platform: at.ref.platform, source: sourceKey(at.ref), file: path, cc: bundle.cc, docs: APPLE_DOCS }} raw={rawHref(at, path)} />
  {/if}
{:else}
  <table class="grid">
    <thead><tr><th>Path</th><th class="num">Size</th><th>Devices</th></tr></thead>
    <tbody>
      {#each bundle.info.files as f (f.path)}
        <tr>
          <td class="mono"><a class="picker-opt" href={versionHref(at, "files", f.path)}><FileIcon kind={f.kind} path={f.path} />{f.path}</a></td>
          <td class="num">{humanBytes(f.size)}</td>
          <td class="dimtext">{#if f.devices}<DeviceNames devices={f.devices} />{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
