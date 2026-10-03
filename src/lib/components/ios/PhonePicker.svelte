<script lang="ts">
  import { page } from "$app/state";
  import { modemLabel } from "#lib/decode/index.ts";
  import { withParams } from "#lib/format.ts";
  import { newestNamed, phoneList, type PhoneRow } from "#lib/phones.ts";
  import PhoneImage from "./PhoneImage.svelte";
  import Picker from "../Picker.svelte";

  let { rows, selected }: { rows: PhoneRow[]; selected?: PhoneRow } = $props();

  const key = (r: PhoneRow) => r.path;
  const label = (r: PhoneRow) => {
    if (!r.phones.length) return `${r.path} (not named for a phone)`;
    const modems = [...new Set(r.phones.map((p) => p.family).filter((f): f is string => !!f))].map(modemLabel).join(", ");
    return `${phoneList(r.phones)}${modems ? ` · ${modems}` : ""}`;
  };
</script>

{#snippet option(r: PhoneRow)}
  <span class="picker-opt"><PhoneImage name={newestNamed(r.phones)} /><span class="text">{label(r)}</span></span>
{/snippet}

{#if rows.length}
  <div class="filters">
    <Picker
      label="Phone"
      items={rows}
      {selected}
      {key}
      {option}
      href={(r) => withParams(page.url, { file: r.path, pri: null, efs: null, base: null })}
    />
  </div>
{/if}
