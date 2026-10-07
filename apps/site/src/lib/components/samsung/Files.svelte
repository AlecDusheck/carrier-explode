<script lang="ts">
  import { asset } from "$app/paths";
  import { getSamsung, getSamsungFile } from "#lib/api/samsung.remote.ts";
  import { humanBytes, verArgs, versionHref } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";

  /** The pack's files, as the Apple tab lists a bundle's: each opens decoded. */
  let { at, path }: TabProps = $props();

  const v = $derived(await getSamsung(verArgs(at)));
  const file = $derived(path ? await getSamsungFile({ ...verArgs(at), path }) : null);
</script>

{#if file}
  <div class="filters"><span class="mono breakall">{file.path}</span></div>
  <pre class="code">{file.text}</pre>
{:else}
  <table class="grid">
    <thead><tr><th>Path</th><th class="num">Size</th></tr></thead>
    <tbody>
      {#each v.files as f (f.path)}
        <tr>
          <td class="mono">
            <a class="picker-opt" href={versionHref(at, "files", f.path)}>
              <img class="file-icon" src={asset(f.path.endsWith(".json") ? "files/metadata.svg" : "files/xml.svg")} alt="" width="20" height="20" />{f.path}
            </a>
          </td>
          <td class="num">{humanBytes(f.size)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
