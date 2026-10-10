<script lang="ts">
  import { page } from "$app/state";
  import { getFeatureModels, getFeaturePhone } from "#lib/api/sources.remote.ts";
  import { withParams } from "#lib/format.ts";
  import type { At } from "#lib/types.ts";
  import ModelPicker from "../ModelPicker.svelte";
  import PhoneChoice from "./PhoneChoice.svelte";

  /** A carrier's phone is its override file, as Settings picks it; a country's carriers are judged on any phone the features pages know. */
  let { at }: { at: At } = $props();
</script>

{#if at.ref.kind === "carrier"}
  <PhoneChoice {at} tab="settings" />
{:else}
  {@const models = (await getFeatureModels()).filter((m) => m.platform === at.ref.platform)}
  {#if models.length}
    {@const named = page.url.searchParams.get("phone") ?? undefined}
    {@const phone = await getFeaturePhone(named === undefined ? {} : { phone: named })}
    <ModelPicker phones={models} selected={phone?.platform === at.ref.platform ? phone.code : models[0]?.variants[0]?.code} href={(code) => withParams(page.url, { phone: code })} />
  {/if}
{/if}
