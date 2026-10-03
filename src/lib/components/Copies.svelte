<script lang="ts">
  import type { Version } from "#lib/types.ts";

  /** Every place this version's bytes come from: OS images and Apple's OTA feed. One version is one content, so they are the same files. */
  let { entry }: { entry: Version } = $props();
</script>

<fieldset class="hgroup">
  <legend>Copies ({entry.copies.length})</legend>
  <table class="grid">
    <thead><tr><th>From</th><th>Where</th><th>Held</th></tr></thead>
    <tbody>
      {#each entry.copies as c, i (i)}
        <tr>
          {#if c.via === "image"}
            <td>Image</td>
            <td class="mono wrap">{c.releases.join(", ")}</td>
            <td>stored</td>
          {:else}
            <td>OTA{c.published ? ` · ${c.published}` : ""}</td>
            <td class="mono wrap"><a href={c.url} rel="noreferrer" download>{c.os.length ? c.os.map((o) => o + "+").join(", ") : "legacy"}</a></td>
            <td>{c.archive.state === "archived" ? "stored" : c.archive.state === "pending" ? "read from Apple" : `read from Apple; archiving failed: ${c.archive.error}`}</td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</fieldset>
