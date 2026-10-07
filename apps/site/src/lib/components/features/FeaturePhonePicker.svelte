<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import type { FeaturePhone } from "#lib/server/features.ts";
  import { visitorDevice, visitorPhone } from "#lib/visitor.ts";
  import PhoneImage from "#lib/components/PhoneImage.svelte";
  import Picker from "#lib/components/Picker.svelte";

  /** Every phone in one list, iPhones then Pixels, each platform under its heading. */
  let { phones, phone }: { phones: readonly FeaturePhone[]; phone: FeaturePhone | null } = $props();

  // A URL naming no phone shows the newest covered one; the visitor's own is a better default.
  $effect(() => {
    if (page.url.searchParams.has("phone")) return;
    const shown = phone?.code;
    const from = page.url.href;
    void (async () => {
      const device = await visitorDevice();
      const mine = visitorPhone(phones, device);
      if (mine && mine.code !== shown && page.url.href === from) await goto(withParams(page.url, { phone: mine.code }), { replace: true });
    })();
  });
</script>

{#snippet option(p: FeaturePhone)}
  <span class="picker-opt"><PhoneImage platform={p.platform} id={p.code} name={p.name} /><span class="text">{p.name}</span></span>
{/snippet}

<div class="filters">
  <Picker
    label="Your phone"
    items={phones}
    selected={phone ?? undefined}
    key={(p) => p.code}
    section={(p) => PLATFORM_NAMES[p.platform]}
    {option}
    href={(p) => withParams(page.url, { phone: p.code })}
  />
</div>
