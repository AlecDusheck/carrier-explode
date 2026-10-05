<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getComparison, getSourceBrands, getSourceHead } from "#lib/api/sources.remote.ts";
  import { withParams } from "#lib/format.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { decoderFamily, isSourceKey, sourceOf, type DecoderFamily, type Platform, type SourceKey } from "@carrier-explode/schema/types";
  import Pane from "#lib/components/Pane.svelte";
  import ConceptCompare from "#lib/components/ConceptCompare.svelte";
  import LinePicker from "#lib/components/LinePicker.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";
  import PhonePicker from "#lib/components/PhonePicker.svelte";
  import Picker from "#lib/components/Picker.svelte";
  import { COMPARE_VIEWS, nativeView } from "#lib/components/views.ts";
  import { fileChoices, pickPhoneRow, type PhoneRow } from "#lib/apple/phones.ts";

  const sp = $derived(page.url.searchParams);
  const file = $derived(sp.get("file"));

  const set = (changes: Record<string, string | null>) => goto(withParams(page.url, changes), { reset: false });

  const swap = () =>
    set({ a: sp.get("b"), al: sp.get("bl"), av: sp.get("bv"), ap: sp.get("bp"), b: sp.get("a"), bl: sp.get("al"), bv: sp.get("av"), bp: sp.get("ap") });

  const familyOf = (key: SourceKey): DecoderFamily => decoderFamily(sourceOf(key).platform);

  /** A side's phones at its version, and the one picked (`ap`/`bp`, else the newest). */
  async function phonesOf(key: "a" | "b", head: Awaited<ReturnType<typeof getSourceHead>>): Promise<{ rows: PhoneRow[]; picked: PhoneRow | undefined }> {
    const rows = await COMPARE_VIEWS[decoderFamily(head.ref.platform)].variants({ ref: head.ref, line: head.line, version: head.entry.slug });
    return { rows, picked: pickPhoneRow(rows, sp.get(`${key}p`)).row };
  }

  /** A side as the query names it: a source key, and its line and version when picked. */
  function side(key: "a" | "b"): { source: SourceKey; line?: string; slug?: string } | null {
    const source = sp.get(key);
    if (!source || !isSourceKey(source)) return null;
    const line = sp.get(`${key}l`);
    const slug = sp.get(`${key}v`);
    return { source, ...(line ? { line } : {}), ...(slug ? { slug } : {}) };
  }

  const a = $derived(side("a"));
  const b = $derived(side("b"));

  /** A cross-platform column: which platform comes first, then the file. */
  const sideName = (key: SourceKey): string => `${PLATFORM_NAMES[sourceOf(key).platform]} · ${sourceOf(key).name}`;

  type SourceOption = { readonly key: SourceKey; readonly brand: string; readonly name: string; readonly platform: Platform };
  const sourceOptions = (sources: ReadonlyArray<{ readonly key: SourceKey; readonly brand: string }>): SourceOption[] =>
    sources.map(({ key, brand }) => ({ key, brand, ...sourceOf(key) }));
</script>

{#snippet picker(title: string, key: "a" | "b", chosen: typeof a, sources: readonly SourceOption[])}
  <fieldset class="hgroup">
    <legend>{title}</legend>
    <div class="rowflex">
      <Picker
        items={sources}
        selected={chosen ? sources.find((s) => s.key === chosen.source) : undefined}
        key={(s) => s.key}
        href={(s) => withParams(page.url, { [key]: s.key, [`${key}l`]: null, [`${key}v`]: null, [`${key}p`]: null })}
        search={(s) => `${s.brand} ${s.name} ${PLATFORM_NAMES[s.platform]}`}
      >
        {#snippet option(s)}
          <span class="picker-opt"><span class="text">{s.brand}</span></span>
          <span class="picker-tag mono">{s.name}</span>
          <span class="picker-tag">{PLATFORM_NAMES[s.platform]}</span>
        {/snippet}
      </Picker>
      {#if chosen}
        <Pane>
          {@const head = await getSourceHead(chosen)}
          {@const phones = await phonesOf(key, head)}
          <LinePicker {head} href={(line) => withParams(page.url, { [`${key}l`]: line, [`${key}v`]: null, [`${key}p`]: null })} />
          <VersionPicker
            timeline={head.timeline}
            current={head.entry.slug}
            head={head.head}
            href={(slug) => withParams(page.url, { [`${key}v`]: slug })}
          />
          <PhonePicker
            platform={head.ref.platform}
            choices={fileChoices(phones.rows, (file) => withParams(page.url, { [`${key}p`]: file }))}
            selected={phones.picked?.path}
          />
        </Pane>
      {:else if sp.get(key)}
        <span class="dimtext">No such bundle</span>
      {/if}
    </div>
  </fieldset>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const sources = sourceOptions(await getSourceBrands())}
      {@render picker("Left", "a", a, sources)}
      {@render picker("Right", "b", b, sources)}

      <div class="rowflex">
        <button class="btn" onclick={swap} disabled={!sp.get("a") && !sp.get("b")}>Swap sides</button>
        {#if [a, b].every((x) => !x || COMPARE_VIEWS[familyOf(x.source)].byFile)}
        <label class="lbl">
          File
          <input
            type="text"
            name="file"
            placeholder="whole bundle"
            value={file ?? ""}
            class="path"
            onchange={(e) => set({ file: e.currentTarget.value.trim() })}
          />
        </label>
        {/if}
      </div>

      {#if a && b}
        <Pane>
          {@const [pa, pb] = await Promise.all([getSourceHead(a).then((h) => phonesOf("a", h)), getSourceHead(b).then((h) => phonesOf("b", h))])}
          {@const seenBy = (s: typeof a, p: typeof pa) => (p.picked ? { ...s, variant: p.picked.path } : s)}
          {@const cmp = await getComparison({ a: seenBy(a, pa), b: seenBy(b, pb), ...(file ? { path: file } : {}) })}
          {#if cmp.by === "concepts"}
            <ConceptCompare comparison={cmp.comparison} left={sideName(cmp.a)} right={sideName(cmp.b)} />
          {:else}
            {@const native = nativeView(cmp)}
            <native.View {...native.props} />
          {/if}
        </Pane>
      {:else}
        <p class="dimtext">Pick two bundles, or one bundle at two versions.</p>
      {/if}
    </Pane>
  </div>
</div>

<style>
  input.path { min-width: 220px; }
</style>
