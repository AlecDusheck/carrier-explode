<script lang="ts">
  import type { Version } from "#lib/types.ts";

  /** Every place this version's bytes come from: OS images and the OTA feeds. One version is one content, so they are the same files. */
  let { entry }: { entry: Version } = $props();
</script>

<table class="grid">
  <thead><tr><th>From</th><th>Where</th></tr></thead>
  <tbody>
    {#each entry.copies as c, i (i)}
      <tr>
        {#if c.kind === "release"}
          <td>Image</td>
          <td class="mono">{c.releases.join(", ")}</td>
        {:else}
          <td>OTA{c.published ? ` · ${c.published}` : ""}</td>
          <td class="mono"><a href={c.url} rel="noreferrer" download>{c.os.length ? c.os.map((o) => o + "+").join(", ") : "legacy"}</a></td>
        {/if}
      </tr>
    {/each}
  </tbody>
</table>
