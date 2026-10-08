<script lang="ts">
  import type { ComparedFile, PhoneChange, PhoneFileChange } from "#lib/server/apple/phones.ts";
  import { rowKey, rowModems, rowName } from "#lib/apple/phones.ts";
  import DiffRows from "../DiffRows.svelte";

  let { changes }: { changes: readonly PhoneChange[] } = $props();

  const anchor = (g: PhoneChange, which: string): string => `phone-${rowKey(g.row).replace(/[^\w]/g, "_")}-${which}`;
  const total = (c: ComparedFile): number => c.counts.added + c.counts.removed + c.counts.changed;
  const changed = $derived(changes.filter((g) => [g.plist, g.modem].some((c) => c?.kind === "changed")));
</script>

{#snippet cell(g: PhoneChange, c: PhoneFileChange | null, which: string)}
  {#if !c}
    <span class="dimtext">none</span>
  {:else if g.status === "new"}
    new for this phone
  {:else if g.status === "absent"}
    <span class="dimtext">not in that version</span>
  {:else if c.kind === "same"}
    <span class="dimtext">no change</span>
  {:else if c.kind === "changed"}
    <a href="#{anchor(g, which)}">{total(c)} {total(c) === 1 ? "change" : "changes"}</a>
  {:else}
    {c.kind}
  {/if}
{/snippet}

<fieldset class="hgroup">
  <legend>Phones ({changes.length})</legend>
  <p class="dimtext note">Each phone's own settings and modem file, against what that phone had before.</p>
  <table class="grid">
    <thead><tr><th>Phones</th><th>Settings</th><th>Modem file</th></tr></thead>
    <tbody>
      {#each changes as g (rowKey(g.row))}
        <tr>
          <td>{rowName(g.row)}{#if rowModems(g.row)}<div class="dimtext">{rowModems(g.row)}</div>{/if}</td>
          <td>{@render cell(g, g.plist, "plist")}</td>
          <td>{@render cell(g, g.modem, "modem")}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</fieldset>

{#each changed as g (rowKey(g.row))}
  {#each [["plist", g.plist], ["modem", g.modem]] as const as [which, c] (which)}
    {#if c?.kind === "changed"}
      <fieldset class="hgroup" id={anchor(g, which)}>
        <legend>{rowName(g.row)}: <span class="mono">{c.path}</span></legend>
        {#if c.before !== c.path}<p class="dimtext note">Was <span class="mono">{c.before}</span>.</p>{/if}
        <DiffRows rows={c.rows} anchor={anchor(g, which)} />
        {#if c.truncated}<p class="dimtext note">First {c.rows.length} of {total(c)} changes.</p>{/if}
      </fieldset>
    {/if}
  {/each}
{/each}
