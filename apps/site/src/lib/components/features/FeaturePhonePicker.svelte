<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";
  import type { ModelChoice } from "#lib/phones.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import type { FeaturePhone } from "#lib/server/features.ts";
  import { visitor } from "#lib/visitor.svelte.ts";
  import ModelPicker from "#lib/components/ModelPicker.svelte";

  /** Every phone in one list, iPhones then Pixels, each platform under its heading; `models` are `phones` grouped. */
  let { phones, models, phone }: { phones: readonly FeaturePhone[]; models: readonly ModelChoice[]; phone: FeaturePhone | null } = $props();

  // A URL naming no phone shows the newest covered iPhone; the guessed phone is a better default.
  $effect(() => {
    const guessed = visitor.guess?.phone;
    if (page.url.searchParams.has("phone") || guessed === undefined) return;
    const mine = phones.find((p) => p.name === guessed);
    if (mine && mine.code !== phone?.code) void goto(withParams(page.url, { phone: mine.code }), { replace: true });
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
