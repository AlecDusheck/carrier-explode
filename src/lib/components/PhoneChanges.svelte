<script lang="ts">
  import type { getPhoneChanges } from "#lib/api/bundles.remote.ts";
  import type { PhoneChange, PhoneFileChange } from "#lib/server/data.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { entryLabel } from "#lib/format.ts";
  import { phoneList } from "#lib/phones.ts";
  import DiffRows from "./DiffRows.svelte";

  let { changes }: { changes: NonNullable<Awaited<ReturnType<typeof getPhoneChanges>>> } = $props();

  const anchor = (g: PhoneChange, which: string) => `phone-${g.phones[0].id.replace(/[^\w]/g, "_")}-${which}`;
  const total = (c: PhoneFileChange) => c.counts.added + c.counts.removed + c.counts.changed;
  const families = (g: PhoneChange) =>
    [...new Set(g.phones.map((p) => p.family).filter((f): f is string => !!f))].map(modemLabel).join(", ");
  const changed = $derived(changes.groups.filter((g) => [g.plist, g.modem].some((c) => c?.kind === "changed")));
</script>

{#snippet cell(g: PhoneChange, c: PhoneFileChange | undefined, which: string)}
  {#if !c}
    <span class="dimtext">none</span>
  {:else if g.status === "new"}
    new for this phone
  {:else if g.status === "unknown"}
    <span class="dimtext">no earlier copy</span>
  {:else if c.kind === "same"}
    <span class="dimtext">no change</span>
  {:else if c.kind === "changed"}
    <a href="#{anchor(g, which)}">{total(c)} {total(c) === 1 ? "change" : "changes"}</a>
  {:else}
    {c.kind}
  {/if}
{/snippet}

<fieldset class="hgroup">
  <legend>Phones ({changes.groups.length})</legend>
  <p class="dimtext note">Each phone's own settings and modem file, against what that phone had before.</p>
  <table class="grid">
    <thead><tr><th>Phones</th><th>Settings</th><th>Modem file</th><th>Compared with</th></tr></thead>
    <tbody>
      {#each changes.groups as g (g.phones[0].id)}
        <tr>
          <td>{phoneList(g.phones)}{#if families(g)}<div class="dimtext">{families(g)}</div>{/if}</td>
          <td>{@render cell(g, g.plist, "plist")}</td>
          <td>{@render cell(g, g.modem, "modem")}</td>
          <td class="dimtext">{g.from ? entryLabel(g.from) : ""}{g.status === "older" ? " (older)" : ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</fieldset>

{#each changed as g (g.phones[0].id)}
  {#each [["plist", g.plist], ["modem", g.modem]] as const as [which, c] (which)}
    {#if c?.kind === "changed"}
      <fieldset class="hgroup" id={anchor(g, which)}>
        <legend>{phoneList(g.phones)}: <span class="mono">{c.path}</span></legend>
        {#if g.status === "older"}
          <p class="dimtext note">
            Against the older copy named above, the newest earlier one with these phones' files; the compared version's copy has none,
            so this spans every update since.
          </p>
        {/if}
        {#if c.before && c.before !== c.path}<p class="dimtext note">Was <span class="mono">{c.before}</span>.</p>{/if}
        <DiffRows rows={c.rows} anchor={anchor(g, which)} />
        {#if c.truncated}<p class="dimtext note">First {c.rows.length} of {total(c)} changes.</p>{/if}
      </fieldset>
    {/if}
  {/each}
{/each}
