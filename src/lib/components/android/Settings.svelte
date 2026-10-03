<script lang="ts">
  import { page } from "$app/state";
  import { getAndroidSettings } from "#lib/api/android.remote.ts";
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import { searchTerms } from "#lib/settings.ts";
  import { TreeState, menuTrigger, copyText, scan, type MenuItem } from "#lib/ui-state.svelte.ts";
  import type { ConfigRow } from "#lib/server/android.ts";
  import type { TabProps } from "#lib/types.ts";
  import TreeToolbar from "../TreeToolbar.svelte";
  import LinePicker from "../LinePicker.svelte";
  import ConfigValue from "./ConfigValue.svelte";

  let { at }: TabProps = $props();

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  const [groups, head] = $derived(await Promise.all([getAndroidSettings(verArgs(at)), getBundleHead(verArgs(at))]));
  const terms = $derived(searchTerms(tree.filter));
  const matches = (r: ConfigRow): boolean =>
    !terms.length || terms.some((t) => r.key.includes(t) || (r.doc?.note.toLowerCase().includes(t) ?? false));

  /** Right-click on a key: the same "compare across" menu the value trees have. */
  function menu(key: string): () => { title: string; items: MenuItem[] } {
    return () => ({
      title: key,
      items: [
        { label: "Compare across all carriers", run: () => scan.start({ platform: "android", path: key, file: "config", scope: "carriers" }) },
        { label: "", separator: true },
        { label: "Copy key", run: () => copyText(key) },
      ],
    });
  }
</script>

<LinePicker {head} tab="settings" />
<TreeToolbar state={tree} label="filter config keys" />

{#each groups as g (g.title)}
  {@const rows = g.rows.filter(matches)}
  {#if rows.length}
    <fieldset class="hgroup">
      <legend>{g.title} ({rows.length})</legend>
      <table class="grid">
        <thead><tr><th>Key</th><th>Value</th><th>What it does</th></tr></thead>
        <tbody>
          {#each rows as r (r.key)}
            <tr {@attach menuTrigger(menu(r.key))}>
              <td class="mono wrap k">
                {r.key}
                {#if r.doc?.deprecated}<span class="badge">deprecated</span>{/if}
                {#if r.doc?.hidden}<span class="badge" title="@hide: not in the public SDK">hidden</span>{/if}
              </td>
              <td class="mono wrap"><ConfigValue value={r.value} /></td>
              <td class="wrap">
                {#if r.doc?.note}{r.doc.note.split("\n\n")[0]}{:else}<span class="dimtext">Not documented in AOSP.</span>{/if}
                {#if r.doc?.default !== undefined}<span class="dimtext"> Default {r.doc.default}.</span>{/if}
                {#if r.doc?.since}<span class="dimtext"> API {r.doc.since}+.</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </fieldset>
  {/if}
{:else}
  <p class="dimtext note">No config keys.</p>
{/each}
