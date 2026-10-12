<script lang="ts">
  import { getAppleBundle, getAppleFile, getAppleModemHead } from "#lib/api/apple.remote.ts";
  import { humanBytes, rawHref, verArgs, versionHref } from "#lib/format.ts";
  import { APPLE_DOCS } from "#lib/apple/tree-docs.ts";
  import type { TabProps } from "#lib/types.ts";
  import FileBody from "../FileBody.svelte";
  import DeviceNames from "../DeviceNames.svelte";
  import FileDevices from "../FileDevices.svelte";
  import ModemConfigView from "../../modem/ModemConfigView.svelte";
  import FileIcon from "../FileIcon.svelte";

  let { at, path }: TabProps = $props();

  const [bundle, file] = $derived(await Promise.all([getAppleBundle(verArgs(at)), path ? getAppleFile({ ...verArgs(at), path }) : null]));
</script>

{#if path && file}
  <!-- A Qualcomm override file reads as its modem configuration, as on the Modem tab. -->
  {@const head = file.kind === "pri-der" || file.kind === "tri-der" ? await getAppleModemHead({ ...verArgs(at), path }) : null}
  <div class="filters"><span class="mono breakall">{path}</span></div>
  {#if head}
    <FileDevices devices={file.devices} />
    <ModemConfigView ref={{ kind: "bundle", ...verArgs(at), path }} {head} />
  {:else}
    <FileBody {file} ctx={{ platform: at.ref.platform, file: path, cc: bundle.cc, docs: APPLE_DOCS }} raw={rawHref(at, path)} />
  {/if}
{:else}
  <table class="grid">
    <thead><tr><th>Path</th><th class="num">Size</th><th>Devices</th></tr></thead>
    <tbody>
      {#each bundle.info.files as f (f.path)}
        <tr>
          <td class="mono"><a class="picker-opt" href={versionHref(at, "files", f.path)}><FileIcon kind={f.kind} path={f.path} />{f.path}</a></td>
          <td class="num">{humanBytes(f.size)}</td>
          <td class="dimtext"><DeviceNames devices={f.devices} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
