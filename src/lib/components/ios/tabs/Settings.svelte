<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getBundleOverrides, getOverridePlist } from "#lib/api/ios.remote.ts";
  import { getRare } from "#lib/api/scan.remote.ts";
  import { withParams } from "#lib/format.ts";
  import { phoneList, phoneRows, pickPhoneRow } from "#lib/phones.ts";
  import { asDict, effective, groupSettings, rareBadges } from "#lib/settings.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import type { TabProps } from "#lib/types.ts";
  import type { KeyBadge } from "../../Tree.svelte";
  import Tree from "../../Tree.svelte";
  import TreeToolbar from "../../TreeToolbar.svelte";
  import PhonePicker from "../PhonePicker.svelte";
  import LocalisedText from "../LocalisedText.svelte";

  let { at }: TabProps = $props();

  const args = $derived({ source: at.source, slug: at.version });
  const sp = $derived(page.url.searchParams);
  const show = $derived(sp.get("show") === "phone" ? "phone" : "all");
  const VIEWS = [["all", "All"], ["phone", "Phone specific"]] as const;

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  const bundle = $derived(await getBundle(args));
  const carrier = $derived(asDict(bundle.quick["carrier.plist"]));
  const ov = $derived(at.ref.kind === "country" ? null : await getBundleOverrides(args));
  const rows = $derived(phoneRows(at.version, bundle.info.files, ov).filter((r) => r.phones.length));
  const picked = $derived(pickPhoneRow(rows, sp.get("file")));
  const over = $derived(picked.row ? await getOverridePlist({ ...args, path: picked.row.path }) : null);
  const phoneDict = $derived(asDict(over?.plist));
  const rare = $derived(await getRare(args));
  const home = $derived(bundle.home ? await getBundle({ source: bundle.home }) : null);
  const homeDict = $derived(asDict(home?.quick["carrier.plist"]));
  const phoneName = $derived(picked.row ? phoneList(picked.row.phones) : "");

  /** Badges merged per key, in a fixed order: source first, then rarity. */
  function badgesFor(keys: readonly string[], phone: ReadonlySet<string>, rareTop: Record<string, KeyBadge[]>, country: ReadonlySet<string>): Record<string, KeyBadge[]> {
    const out: Record<string, KeyBadge[]> = {};
    for (const k of keys) {
      const b: KeyBadge[] = [];
      if (phone.has(k)) b.push({ text: "phone", tone: "phone", title: `Set by ${phoneName}'s override file` });
      if (country.has(k)) b.push({ text: "country too", tone: "country", title: "The home country bundle sets this too; which one wins is not documented" });
      b.push(...(rareTop[k] ?? []));
      if (b.length) out[k] = b;
    }
    return out;
  }
</script>

<PhonePicker {rows} selected={picked.row} />
{#if picked.missing}
  <div class="banner">No phone reads <span class="mono">{picked.missing}</span> in this version; showing {picked.row ? phoneList(picked.row.phones) : "carrier.plist alone"} instead.</div>
{/if}
<TreeToolbar state={tree} label="filter settings">
  {#each VIEWS as [v, label] (v)}
    {#if v !== "phone" || phoneDict}
      <a class="btn" href={withParams(page.url, { show: v === "all" ? null : v })} aria-current={show === v ? "page" : undefined}>{label}</a>
    {/if}
  {/each}
</TreeToolbar>

{#if !carrier}
  <div class="banner">No carrier.plist.</div>
{:else}
  {@const eff = effective(carrier, phoneDict)}
  {@const shown = Object.fromEntries(Object.entries(eff.merged).filter(([k]) => show === "all" || eff.fromPhone.has(k)))}
  {@const badges = badgesFor(Object.keys(shown), eff.fromPhone, rare.indexed ? rareBadges(rare.rows) : {}, new Set(Object.keys(homeDict ?? {})))}

  {#if phoneDict}
    <p class="dimtext note">carrier.plist + <span class="mono">{over?.path}</span></p>
  {:else if rows.length}
    <p class="dimtext note">No override plist for these phones.</p>
  {/if}

  {#each groupSettings(shown) as [title, group] (title)}
    <fieldset class="hgroup">
      <legend>{title} ({Object.keys(group).length})</legend>
      <Tree value={group} ctx={{ platform: "ios", source: at.source, file: "carrier.plist", cc: bundle.cc }} state={tree} {badges} />
    </fieldset>
  {:else}
    <p class="dimtext note">No keys in this view.</p>
  {/each}
{/if}

{#if bundle.info.locales.length && show === "all"}
  <fieldset class="hgroup" id="text">
    <legend>Localised text ({bundle.info.locales.length} languages)</legend>
    <LocalisedText {bundle} />
  </fieldset>
{/if}
