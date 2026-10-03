<script lang="ts">
  import { getAndroidApns } from "#lib/api/android.remote.ts";
  import type { ShownApn } from "#lib/server/android.ts";
  import type { TabProps } from "#lib/types.ts";

  let { at }: TabProps = $props();

  const apns = $derived(await getAndroidApns({ source: at.source, slug: at.version }));

  /** Each field the file sets beyond the columns, as `name=value`. */
  const COLUMNS = new Set(["name", "value", "type", "protocol", "roamingProtocol", "hasPassword"]);
  const extra = (a: ShownApn): string =>
    Object.entries(a).filter(([k, v]) => !COLUMNS.has(k) && v !== undefined).map(([k, v]) => `${k}=${String(v)}`).join("  ");
</script>

<table class="grid">
  <thead><tr><th>Name</th><th>APN</th><th>Types</th><th>Protocol</th><th>Roaming</th><th>Other fields</th></tr></thead>
  <tbody>
    {#each apns as a, i (i)}
      <tr>
        <td>{a.name ?? ""}</td>
        <td class="mono">{a.value ?? ""}</td>
        <td class="mono">{a.type.join(", ")}</td>
        <td class="mono">{a.protocol ?? ""}</td>
        <td class="mono">{a.roamingProtocol ?? ""}</td>
        <td class="mono wrap dimtext">{extra(a)}{a.hasPassword ? "  password set" : ""}</td>
      </tr>
    {:else}
      <tr><td colspan="6" class="dimtext">No APNs.</td></tr>
    {/each}
  </tbody>
</table>
