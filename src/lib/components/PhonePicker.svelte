<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { modemLabel } from "#lib/decode/index.ts";
  import { withParams } from "#lib/format.ts";
  import { phoneList, type PhoneRow } from "#lib/phones.ts";

  let { rows, selected }: { rows: PhoneRow[]; selected?: PhoneRow } = $props();

  const key = (r: PhoneRow) => `${r.copy ?? ""}\0${r.path}`;
  const label = (r: PhoneRow) => {
    if (!r.phones.length) return `${r.path} (not named for a phone)`;
    const modems = [...new Set(r.phones.map((p) => p.family).filter((f): f is string => !!f))].map(modemLabel).join(", ");
    return `${phoneList(r.phones)}${modems ? ` · ${modems}` : ""}`;
  };

  function pick(e: Event & { currentTarget: HTMLSelectElement }) {
    const r = rows.find((x) => key(x) === e.currentTarget.value);
    if (r) goto(withParams(page.url, { file: r.path, copy: r.copy ?? null, pri: null, efs: null, base: null }), { replace: true, reset: false });
  }
</script>

{#if rows.length}
  <div class="filters">
    <label class="lbl grow">
      Phone
      <select name="phone" value={selected ? key(selected) : ""} onchange={pick}>
        {#each rows as r (key(r))}<option value={key(r)}>{label(r)}</option>{/each}
      </select>
    </label>
  </div>
{/if}
