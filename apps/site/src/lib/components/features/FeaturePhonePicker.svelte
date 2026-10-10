<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";
  import type { ModelChoice } from "#lib/phones.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import type { FeaturePhone } from "#lib/server/features.ts";
  import { visitorGuess } from "#lib/visitor.ts";
  import ModelPicker from "#lib/components/ModelPicker.svelte";

  /** Every phone in one list, iPhones then Pixels, each platform under its heading; `models` are `phones` grouped. */
  let { phones, models, phone }: { phones: readonly FeaturePhone[]; models: readonly ModelChoice[]; phone: FeaturePhone | null } = $props();

  // A URL naming no phone shows the newest covered iPhone; the guessed phone is a better default.
  $effect(() => {
    if (page.url.searchParams.has("phone")) return;
    const shown = phone?.code;
    const from = page.url.href;
    void (async () => {
      const { phone: guessed } = await visitorGuess();
      const mine = phones.find((p) => p.name === guessed);
      if (mine && mine.code !== shown && page.url.href === from) await goto(withParams(page.url, { phone: mine.code }), { replace: true });
    })();
  });
</script>

<div class="filters">
  <ModelPicker
    label="Your phone"
    phones={models}
    selected={phone?.code}
    section={(p) => PLATFORM_NAMES[p.platform]}
    href={(code) => withParams(page.url, { phone: code })}
  />
</div>
