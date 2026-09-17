<script lang="ts">
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { bundleArgs, bundleHref, fileHref, humanBytes, rawHref } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    {#if params.path}
      <div class="rowflex" style="margin-bottom:6px">
        <a class="btn" href={bundleHref(params.kind, params.name, params.version, "files")}>All files</a>
        <span class="mono" style="word-break:break-all">{params.path}</span>
      </div>
      <FileBody
        file={await getFile({ kind: params.kind, name: params.name, slug: params.version, path: params.path })}
        cc={bundle.cc}
        raw={rawHref(params.kind, params.name, params.version, params.path)}
      />
    {:else}
      <table class="grid">
        <thead><tr><th>Path</th><th>Kind</th><th class="num">Size</th><th>Devices</th></tr></thead>
        <tbody>
          {#each bundle.info.files as f (f.path)}
            <tr>
              <td class="mono wrap"><a href={fileHref(params.kind, params.name, params.version, f.path)}>{f.path}</a></td>
              <td>{f.kind}</td>
              <td class="num">{humanBytes(f.size)}</td>
              <td class="dimtext">{f.devices?.map((d) => d.name ?? d.code).join(", ") ?? ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Pane>
</div>
