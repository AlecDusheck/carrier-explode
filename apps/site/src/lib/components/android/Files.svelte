<script lang="ts">
  import { asset } from "$app/paths";
  import { getAndroidFile, getAndroidFiles } from "#lib/api/android.remote.ts";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { hexDump, humanBytes, verArgs, versionHref } from "#lib/format.ts";
  import { androidDocs } from "#lib/android/tree-docs.ts";
  import { NO_DOCS } from "#lib/tree-docs.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { AndroidFileKind } from "#lib/server/android/settings.ts";
  import type { TabProps } from "#lib/types.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import Tree from "../Tree.svelte";
  import TreeToolbar from "../TreeToolbar.svelte";
  import SelectedBy from "./SelectedBy.svelte";

  /** The version's files, as the Apple tab lists a bundle's: each opens decoded. */
  let { at, path }: TabProps = $props();

  const ICONS = { settings: "protobuf", vendor: "binary", "carrier-list": "protobuf" } as const satisfies Record<AndroidFileKind, string>;

  const files = $derived(await getAndroidFiles(verArgs(at)));
  const file = $derived(path ? await getAndroidFile({ ...verArgs(at), path }) : null);
  const head = $derived(await getSourceHead(verArgs(at)));
  const tree = new TreeState();
  const ctx = $derived({ platform: at.ref.platform, source: sourceKey(at.ref), cc: head.cc ?? undefined });
</script>

{#if file}
  <div class="filters"><span class="mono breakall">{file.path}</span></div>
  {#if file.kind === "settings"}
    <!-- The message's own fields, each where the scan index files it, so "compare across" reads the same keys. -->
    <table class="grid fit">
      <tbody>
        <tr><td class="k mono">canonical_name</td><td class="mono">{file.canonicalName}</td></tr>
        <tr><td class="k mono">version</td><td class="mono">{file.version ?? "none of its own: a part of others.pb"}</td></tr>
      </tbody>
    </table>
    <TreeToolbar state={tree} label="filter the file" />
    <fieldset class="hgroup">
      <legend>configs ({Object.keys(file.configs).length})</legend>
      <Tree value={file.configs} ctx={{ ...ctx, file: "config", docs: androidDocs(file.docs) }} state={tree} />
    </fieldset>
    <fieldset class="hgroup">
      <legend>apns ({file.apns.length})</legend>
      <Tree value={{ apns: file.apns }} ctx={{ ...ctx, file: "", docs: NO_DOCS }} state={tree} />
    </fieldset>
    {#if file.vendor.length}
      <fieldset class="hgroup">
        <legend>vendor_configs ({file.vendor.length})</legend>
        {#each file.vendor as f (f.path)}
          <div class="mono"><a href={versionHref(at, "files", f.path)}>{f.path}</a> <span class="dimtext">{humanBytes(f.size)}</span></div>
        {/each}
      </fieldset>
    {/if}
  {:else if file.kind === "vendor"}
    <p class="dimtext note">Opaque to Android: read only by the vendor client it is named for.</p>
    <pre class="code hex">{hexDump(file.hex, true)}</pre>
  {:else}
    <SelectedBy name={at.ref.name} selectedBy={file.selectedBy} />
  {/if}
{:else}
  <table class="grid">
    <thead><tr><th>Path</th><th class="num">Size</th></tr></thead>
    <tbody>
      {#each files as f (f.path)}
        <tr>
          <td class="mono">
            <a class="picker-opt" href={versionHref(at, "files", f.path)}>
              <img class="file-icon" src={asset(`files/${ICONS[f.kind]}.svg`)} alt="" width="20" height="20" />{f.path}
            </a>
          </td>
          <td class="num">{humanBytes(f.size)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
