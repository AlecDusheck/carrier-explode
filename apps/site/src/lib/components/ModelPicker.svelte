<script lang="ts">
  import type { PhoneVariant } from "@carrier-explode/schema";
  import { getVisitorCountry } from "#lib/api/sources.remote.ts";
  import { differsByCountry, openingVariant, type ModelChoice } from "#lib/phones.ts";
  import PhoneImage from "./PhoneImage.svelte";
  import Picker from "./Picker.svelte";

  /** One row per phone, then the open phone's variants when it has more than one; every row links to a variant's page. */
  interface Props {
    phones: readonly ModelChoice[];
    selected: string | undefined;
    href: (code: string) => string;
    label?: string | undefined;
    section?: ((p: ModelChoice) => string) | undefined;
  }

  let { phones, selected, href, label, section }: Props = $props();

  const phone = $derived(phones.find((p) => p.variants.some((v) => v.code === selected)));
  const variant = $derived(phone?.variants.find((v) => v.code === selected));

  // Read after the page has drawn, so the server's page reads no visitor and the edge can keep it.
  let country: string | null = $state(null);
  $effect(() => {
    if (!differsByCountry(phones)) return;
    void (async () => {
      country = await getVisitorCountry();
    })();
  });

  const opens = (p: ModelChoice): string =>
    p === phone && selected !== undefined ? selected : (openingVariant(p, country)?.code ?? p.key);
</script>

{#snippet phoneOption(p: ModelChoice)}
  <span class="picker-opt"><PhoneImage platform={p.platform} id={p.variants[0]?.code || undefined} name={p.name} /><span class="text">{p.label}</span></span>
{/snippet}

{#snippet variantOption(v: PhoneVariant)}
  {#if v.descriptor === null}
    <span class="picker-opt"><span class="text mono">{v.code}</span></span>
  {:else}
    <span class="picker-opt"><span class="text">{v.descriptor}</span></span>
    <span class="picker-tag mono">{v.code}</span>
  {/if}
{/snippet}

{#if phones.length}
  <Picker {label} items={phones} selected={phone} key={(p) => p.key} option={phoneOption} href={(p) => href(opens(p))} {section} />
  {#if phone && phone.variants.length > 1}
    <Picker items={phone.variants} selected={variant} key={(v) => v.code} option={variantOption} href={(v) => href(v.code)} />
  {/if}
{/if}
