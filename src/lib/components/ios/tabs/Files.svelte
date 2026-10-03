<script lang="ts">
  import { getBundle, getFile } from "#lib/api/bundles.remote.ts";
  import { humanBytes, rawHref, verArgs, versionHref } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import FileBody from "../FileBody.svelte";
  import FileIcon from "../FileIcon.svelte";

  let { at, path }: TabProps = $props();

  const bundle = $derived(await getBundle(verArgs(at)));
</script>

{#if path}
  <div class="filters"><span class="mono breakall">{path}</span></div>
  <FileBody
    file={await getFile({ ...verArgs(at), path })}
    ctx={{ platform: at.ref.platform, source: at.source, file: path, cc: bundle.cc }}
    raw={rawHref(at, path)}
  />
{:else}
  <table class="grid">
    <thead><tr><th>Path</th><th class="num">Size</th><th>Devices</th></tr></thead>
    <tbody>
      {#each bundle.info.files as f (f.path)}
        <tr>
          <td class="mono wrap"><a class="picker-opt" href={versionHref(at, "files", f.path)}><FileIcon kind={f.kind} path={f.path} />{f.path}</a></td>
          <td class="num">{humanBytes(f.size)}</td>
          <td class="dimtext">{f.devices?.map((d) => d.name ?? d.code).join(", ") ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
