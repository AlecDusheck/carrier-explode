<script lang="ts">
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";
  import PhoneImage from "#lib/components/ios/PhoneImage.svelte";
  import Picker from "#lib/components/Picker.svelte";

  type Phone = { id: string; name: string };
  let { phones, phone }: { phones: Phone[]; phone?: Phone } = $props();
</script>

<div class="filters">
  <Picker label="Your iPhone" items={phones} selected={phone} key={(p) => p.id} href={(p) => withParams(page.url, { phone: p.id })}>
    {#snippet option(p)}
      <span class="picker-opt"><PhoneImage name={p.name} /><span class="text">{p.name}</span></span>
    {/snippet}
  </Picker>
</div>
