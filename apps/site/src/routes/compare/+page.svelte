<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getCarrierMembers, getComparison, getSourceBrands, getSourceHead } from "#lib/api/sources.remote.ts";
  import { headAt } from "#lib/at.ts";
  import { withParams } from "#lib/format.ts";
  import type { Ver } from "#lib/types.ts";
  import type { SourceHead } from "#lib/server/head.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { decoderFamily, isSourceKey, sourceOf, type DecoderFamily, type Platform, type SourceKey } from "@carrier-explode/schema/types";
  import Pane from "#lib/components/Pane.svelte";
  import ConceptCompare from "#lib/components/ConceptCompare.svelte";
  import LinePicker from "#lib/components/LinePicker.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";
  import PhonePicker from "#lib/components/PhonePicker.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import Picker from "#lib/components/Picker.svelte";
  import { COMPARE_VIEWS, nativeView } from "#lib/components/views.ts";
  import { fileChoices, pickPhoneRows, rowKey, type PhoneRow } from "#lib/apple/phones.ts";
  import { suggestedFirst, suggestions } from "#lib/counterparts.ts";
  import { guessedVariant } from "#lib/guess.ts";
  import { visitor } from "#lib/visitor.svelte.ts";

  const sp = $derived(page.url.searchParams);
  const file = $derived(sp.get("file"));

  const set = (changes: Record<string, string | null>) => goto(withParams(page.url, changes), { reset: false });

  const swap = () =>
    set({ a: sp.get("b"), al: sp.get("bl"), av: sp.get("bv"), ap: sp.get("bp"), b: sp.get("a"), bl: sp.get("al"), bv: sp.get("av"), bp: sp.get("ap") });

  const familyOf = (key: SourceKey): DecoderFamily => decoderFamily(sourceOf(key).platform);

  /** A side as the query names it: a source key, and its line and version when picked. */
  function side(key: "a" | "b"): Ver | null {
    const source = sp.get(key);
    if (!source || !isSourceKey(source)) return null;
    const line = sp.get(`${key}l`);
    const slug = sp.get(`${key}v`);
    return { source, ...(line ? { line } : {}), ...(slug ? { slug } : {}) };
  }

  const headOf = (s: Ver | null): Promise<SourceHead> | null => (s ? getSourceHead(s) : null);

  const rowsOf = async (head: SourceHead | null): Promise<PhoneRow[]> =>
    head ? COMPARE_VIEWS[decoderFamily(head.ref.platform)].variants(headAt(head)) : [];

  type SidePhones = { readonly rows: readonly PhoneRow[]; readonly picked: PhoneRow | undefined };

  /** Both sides' phones and the one each is seen by. Heads and picks are arguments: a reactive read after an await is not tracked. */
  async function sidesPhones(
    a: SourceHead | null,
    b: SourceHead | null,
    ap: string | null,
    bp: string | null,
  ): Promise<{ readonly a: SidePhones; readonly b: SidePhones }> {
    const [ra, rb] = await Promise.all([rowsOf(a), rowsOf(b)]);
    const [pa, pb] = pickPhoneRows({ rows: ra, file: ap }, { rows: rb, file: bp });
    return { a: { rows: ra, picked: pa }, b: { rows: rb, picked: pb } };
  }

  const a = $derived(side("a"));
  const b = $derived(side("b"));

  // A URL naming no left side opens it on the guessed carrier, seen by the guessed phone. Once, when the guess is
  // known: a swap that empties the left side keeps it empty.
  $effect(() => {
    const g = visitor.guess;
    if (g === null) return;
    untrack(() => {
      if (sp.has("a")) return;
      const from = page.url.href;
      void (async () => {
        const { bundle } = g;
        if (bundle === null) return;
        const head = await getSourceHead({ source: bundle });
        const line = guessedVariant(head.lines, g)?.code;
        const al = line !== undefined && line !== head.line ? line : null;
        const rows = await rowsOf(await getSourceHead({ source: bundle, ...(al ? { line: al } : {}) }));
        const row = rows.find((r) => r.phones.some((p) => p.name === g.phone));
        if (page.url.href === from) await goto(withParams(page.url, { a: bundle, al, ap: row ? rowKey(row) : null }), { replace: true });
      })();
    });
  });

  /** A cross-platform column: which platform comes first, then the file. */
  const sideName = (key: SourceKey): string => `${PLATFORM_NAMES[sourceOf(key).platform]} · ${sourceOf(key).name}`;

  type Brand = Awaited<ReturnType<typeof getSourceBrands>>[number];
  type SourceOption = Brand & { readonly name: string; readonly platform: Platform };
  const sourceOptions = (sources: readonly Brand[]): SourceOption[] => sources.map((s) => ({ ...s, ...sourceOf(s.key) }));

  /** What a side's picker offers first: the other side's carrier on other platforms. */
  const suggestedOpposite = async (other: typeof a): Promise<SourceKey[]> =>
    other ? suggestions(other.source, await getCarrierMembers(other.source)) : [];

  const [brands, suggestA, suggestB] = $derived(await Promise.all([getSourceBrands(), suggestedOpposite(b), suggestedOpposite(a)]));
  const sources = $derived(sourceOptions(brands));
  const itemsA = $derived(suggestedFirst(sources, suggestA));
  const itemsB = $derived(suggestedFirst(sources, suggestB));
</script>

{#snippet picker(title: string, key: "a" | "b", chosen: typeof a, items: readonly SourceOption[], suggested: readonly SourceKey[])}
  <fieldset class="hgroup">
    <legend>{title}</legend>
    <div class="rowflex">
      <Picker
        {items}
        selected={chosen ? items.find((s) => s.key === chosen.source) : undefined}
        key={(s) => s.key}
        href={(s) => withParams(page.url, { [key]: s.key, [`${key}l`]: null, [`${key}v`]: null, [`${key}p`]: null })}
        search={(s) => `${s.brand} ${s.name} ${PLATFORM_NAMES[s.platform]}`}
        section={suggested.length ? (s) => (suggested.includes(s.key) ? "Suggested" : "All") : undefined}
      >
        {#snippet option(s)}
          <span class="picker-opt"><SourceIcon picture={s.picture} /><span class="ellipsis">{s.brand}</span></span>
          <span class="picker-tag mono">{s.name}</span>
          <span class="picker-tag">{PLATFORM_NAMES[s.platform]}</span>
        {/snippet}
      </Picker>
      {#if chosen}
        <Pane>
          {@const [head, ha, hb] = await Promise.all([getSourceHead(chosen), headOf(a), headOf(b)])}
          {@const phones = (await sidesPhones(ha, hb, sp.get("ap"), sp.get("bp")))[key]}
          <LinePicker {head} href={(line) => withParams(page.url, { [`${key}l`]: line, [`${key}v`]: null, [`${key}p`]: null })} />
          <VersionPicker
            timeline={head.timeline}
            current={head.entry.slug}
            shipping={head.current}
            href={(slug) => withParams(page.url, { [`${key}v`]: slug })}
          />
          <PhonePicker
            platform={head.ref.platform}
            choices={fileChoices(phones.rows, (file) => withParams(page.url, { [`${key}p`]: file }))}
            selected={phones.picked && rowKey(phones.picked)}
          />
        </Pane>
      {:else if sp.get(key)}
        <span class="dimtext">Not found</span>
      {/if}
    </div>
  </fieldset>
{/snippet}

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@render picker("Left", "a", a, itemsA, suggestA)}
      {@render picker("Right", "b", b, itemsB, suggestB)}

      <div class="rowflex">
        <button class="btn" onclick={swap} disabled={!sp.get("a") && !sp.get("b")}>Swap sides</button>
        {#if a && b && [a, b].every((x) => COMPARE_VIEWS[familyOf(x.source)].byFile)}
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
        <Pane awaiting={{ kind: "diff", name: `${sourceOf(a.source).name}, ${sourceOf(b.source).name}` }}>
          {@const [ha, hb] = await Promise.all([headOf(a), headOf(b)])}
          {@const { a: pa, b: pb } = await sidesPhones(ha, hb, sp.get("ap"), sp.get("bp"))}
          {@const seenBy = (s: typeof a, p: typeof pa) => (p.picked?.kind === "file" ? { ...s, variant: p.picked.path } : s)}
          {@const cmp = await getComparison({ a: seenBy(a, pa), b: seenBy(b, pb), ...(file ? { path: file } : {}) })}
          {#if cmp.by === "concepts"}
            <ConceptCompare comparison={cmp.comparison} left={sideName(cmp.a)} right={sideName(cmp.b)} />
          {:else}
            {@const native = await nativeView(cmp)}
            <native.View {...native.props} />
          {/if}
        </Pane>
      {:else}
        <p class="dimtext">Pick two sides, or one at two versions.</p>
      {/if}
    </Pane>
  </div>
</div>

<style>
  input.path { min-width: 220px; }
</style>
