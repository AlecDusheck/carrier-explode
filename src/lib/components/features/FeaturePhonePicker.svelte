<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";

  let { phones, phone }: { phones: Array<{ id: string; name: string }>; phone?: { id: string; name: string } } = $props();
</script>

<div class="filters">
  <label class="lbl grow">
    Your iPhone
    <select name="phone" value={phone?.id} onchange={(e) => goto(withParams(page.url, { phone: e.currentTarget.value }), { replace: true, reset: false })}>
      {#each phones as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>
</div>
