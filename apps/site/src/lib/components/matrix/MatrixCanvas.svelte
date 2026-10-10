<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { MODE_NAMES, ruleWhat, type Requirement, type Rule, type RuleId } from "#lib/feature-matrix.ts";
  import { asset } from "$app/paths";
  import { featureIcon, featureIconImage } from "#lib/feature-icons.ts";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import FeatureTip from "./FeatureTip.svelte";
  import ToneKey from "./ToneKey.svelte";
  import { atRest, releaseVelocity, rubber, step, type Bounds, type Motion, type Sample } from "./inertia.ts";
  import { cellWords, tileTone, TONE_WORDS, toneOf, type Scored } from "./score.ts";
  import { countedColumns, metCount } from "./view.ts";

  /**
   * Carriers down, rules across, panned with a finger or a wheel. Only rows in view are drawn; the header and the
   * names move on one axis, the tiles on both, all by transform.
   */
  let {
    rows,
    rules,
    columns,
    reqs,
    picked,
    onpick,
    featureHref,
  }: {
    rows: readonly Scored[];
    /** Every rule `Scored.outcomes` is in the order of. */
    rules: readonly Rule[];
    /** The rules shown, as indexes into `rules`. */
    columns: readonly number[];
    reqs: ReadonlyMap<RuleId, Requirement>;
    /** How many of `columns`, from the first, the visitor picked; the rest are shown muted. */
    picked: number;
    onpick: (row: Scored) => void;
    /** A rule's feature page, when it reads a feature that has one. */
    featureHref: (rule: Rule) => string | null;
  } = $props();

  const CELL = 48;
  const HEAD = 66;
  const OVERSCAN = 4;

  let vw = $state(0);
  let vh = $state(0);
  const nameW = $derived(vw < 560 ? 132 : 240);
  const bx: Bounds = $derived([Math.min(0, vw - nameW - columns.length * CELL), 0]);
  const by: Bounds = $derived([Math.min(0, vh - HEAD - rows.length * CELL), 0]);

  // Raw offsets may sit past an edge while a finger or a fling holds them; at rest they are clamped, so a shorter list never leaves the view blank.
  let rawX = $state(0);
  let rawY = $state(0);
  let moving = $state(false);
  const clamp = (p: number, [min, max]: Bounds): number => Math.min(max, Math.max(min, p));
  const x = $derived(moving ? rawX : clamp(rawX, bx));
  const y = $derived(moving ? rawY : clamp(rawY, by));

  const first = $derived(Math.max(0, Math.floor(-y / CELL) - OVERSCAN));
  const last = $derived(Math.min(rows.length, Math.ceil((vh - y) / CELL) + OVERSCAN));
  const drawn = $derived(rows.slice(first, last));
  // Until first measured, as on the server, every name is drawn with its tiles in words, so a reader without script
  // has them all. A hidden pane measures 0 later on, which must not draw them all again.
  let measured = $state(false);
  $effect(() => {
    if (vh > 0) measured = true;
  });
  const namesFirst = $derived(measured ? first : 0);
  const names = $derived(measured ? drawn : rows);

  const modeOf = (rule: Rule) => reqs.get(rule.id)?.mode ?? "off";

  const counted = $derived(countedColumns(columns, picked));
  /** A row's counted tiles in words, for whatever reads the page as text; the Markdown view has every column. */
  const words = (s: Scored): string =>
    counted
      .flatMap((c) => {
        const rule = rules[c];
        return rule ? [`${rule.name}: ${TONE_WORDS[tileTone(s, c, modeOf(rule))]}`] : [];
      })
      .join(" · ");

  /** `at`: the cell it explains, so a second tap on it closes it. */
  let tip: { at: string; title: string; tone: string; lines: string[]; left: number; top: number } | null = $state(null);
  const spot = (at: { r: number; c: number | null }): string => `${at.r}:${at.c ?? "name"}`;
  let view: HTMLElement | undefined = $state();

  // While a tooltip is open, a press anywhere outside the matrix only closes it: that press opens, follows or
  // focuses nothing. Captured before anything under it sees it; its click is swallowed too.
  $effect(() => {
    if (!tip) return;
    let swallow = false;
    const press = (e: PointerEvent) => {
      if (e.target instanceof Node && view?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      swallow = true;
      tip = null;
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") tip = null;
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      // The swallowed click arrives after the tooltip is gone, so its listener outlives the tooltip by one click.
      if (swallow) setTimeout(() => window.removeEventListener("click", click, true), 400);
      else window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key);
    };
  });

  /** The cell or name under a point in the view, by arithmetic: no element per cell listens. */
  function hit(px: number, py: number): { r: number; c: number | null } | null {
    if (py < HEAD) return null;
    const r = Math.floor((py - HEAD - y) / CELL);
    if (r < 0 || r >= rows.length) return null;
    if (px < nameW) return { r, c: null };
    const c = Math.floor((px - nameW - x) / CELL);
    return c >= 0 && c < columns.length ? { r, c } : null;
  }

  function show(at: { r: number; c: number | null }) {
    const s = rows[at.r];
    if (!s) return;
    const top = Math.min(HEAD + y + (at.r + 1) * CELL, vh - 110);
    if (at.c === null) {
      tip = null;
      onpick(s);
      return;
    }
    const i = columns[at.c];
    const rule = i === undefined ? undefined : rules[i];
    if (!rule || i === undefined) return;
    const mode = modeOf(rule);
    const outcome = s.outcomes[i] ?? null;
    tip = {
      at: spot(at),
      title: rule.name,
      tone: toneOf(outcome, mode, s.cells[i] ?? "unknown"),
      lines: [
        `${s.row.entry.brand}: ${outcome === null ? "no data" : s.cells[i] === "available" && outcome ? "offered, but off until you turn it on" : outcome ? "yes" : "no"} (${cellWords(s.cells[i] ?? "unknown")})${mode === "off" ? "" : ` · ${MODE_NAMES[mode]}`}`,
        ruleWhat(rule),
      ],
      left: Math.max(4, Math.min(nameW + x + at.c * CELL, vw - 248)),
      top,
    };
  }

  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  function fling(mx: Motion, my: Motion) {
    moving = true;
    let then = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(32, now - then);
      then = now;
      mx = step(mx, bx, dt);
      my = step(my, by, dt);
      rawX = mx.p;
      rawY = my.p;
      if (atRest(mx, bx) && atRest(my, by)) {
        raf = 0;
        moving = false;
      } else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  /** Moving further than this makes a press a drag rather than a tap. */
  const SLOP = 8;
  let drag: { id: number; x0: number; y0: number; px: number; py: number; moved: boolean; sx: Sample[]; sy: Sample[] } | null = null;

  const local = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - box.left, py: e.clientY - box.top };
  };

  function onpointerdown(e: PointerEvent & { currentTarget: HTMLElement }) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stop();
    rawX = x;
    rawY = y;
    moving = false;
    drag = { id: e.pointerId, x0: x, y0: y, px: e.clientX, py: e.clientY, moved: false, sx: [], sy: [] };
  }

  function onpointermove(e: PointerEvent & { currentTarget: HTMLElement }) {
    if (drag?.id !== e.pointerId) {
      // A mouse hovering shows what is under it; a finger has no hover.
      if (e.pointerType === "mouse" && !drag) {
        const { px, py } = local(e);
        const at = hit(px, py);
        if (at) show(at);
        else tip = null;
      }
      return;
    }
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;
      drag.moved = true;
      moving = true;
      tip = null;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    rawX = rubber(drag.x0 + dx, bx, vw);
    rawY = rubber(drag.y0 + dy, by, vh);
    const t = e.timeStamp;
    drag.sx = [...drag.sx.slice(-5), { t, p: rawX }];
    drag.sy = [...drag.sy.slice(-5), { t, p: rawY }];
  }

  function onpointerup(e: PointerEvent & { currentTarget: HTMLElement }) {
    if (drag?.id !== e.pointerId) return;
    const { moved, sx, sy } = drag;
    drag = null;
    if (!moved) {
      const { px, py } = local(e);
      const at = hit(px, py);
      // A tap on the explained cell, or on nothing, closes it; on another cell it switches.
      if (!at || (e.target instanceof Element && e.target.closest("a")) || tip?.at === spot(at)) tip = null;
      else show(at);
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      rawX = clamp(rawX, bx);
      rawY = clamp(rawY, by);
      moving = false;
      return;
    }
    fling({ p: rawX, v: releaseVelocity(sx) }, { p: rawY, v: releaseVelocity(sy) });
  }

  function onpointercancel() {
    drag = null;
    fling({ p: rawX, v: 0 }, { p: rawY, v: 0 });
  }

  // A wheel or trackpad pans; non-passive, so the page does not take it. Its own momentum is the device's.
  const wheel: Attachment<HTMLElement> = (node) => {
    const pan = (e: WheelEvent) => {
      e.preventDefault();
      stop();
      moving = false;
      tip = null;
      const [dx, dy] = e.shiftKey ? [e.deltaY, e.deltaX] : [e.deltaX, e.deltaY];
      rawX = clamp(x - dx, bx);
      rawY = clamp(y - dy, by);
    };
    node.addEventListener("wheel", pan, { passive: false });
    return () => node.removeEventListener("wheel", pan);
  };

  function onkeydown(e: KeyboardEvent) {
    const by1: Record<string, [number, number]> = {
      ArrowLeft: [CELL, 0],
      ArrowRight: [-CELL, 0],
      ArrowUp: [0, CELL],
      ArrowDown: [0, -CELL],
      PageUp: [0, vh - HEAD],
      PageDown: [0, HEAD - vh],
    };
    const d = by1[e.key];
    if (!d) return;
    e.preventDefault();
    stop();
    rawX = clamp(x + d[0], bx);
    rawY = clamp(y + d[1], by);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="mx"
  role="grid"
  aria-label="Carriers by requirement"
  aria-rowcount={rows.length}
  tabindex="0"
  style:--name-w="{nameW}px"
  style:--stipple={`url("${asset("stipple.svg")}")`}
  style:--lock={featureIconImage("lock")}
  style:--switch={featureIconImage("toggle")}
  bind:this={view}
  bind:clientWidth={vw}
  bind:clientHeight={vh}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  onpointerleave={(e) => e.pointerType === "mouse" && !drag && (tip = null)}
  {onkeydown}
  {@attach wheel}
>
  <div class="clip cells">
    <div class="layer" style:transform="translate3d({x}px, {y}px, 0)" style:height="{rows.length * CELL}px" style:width="{columns.length * CELL}px">
      {#each drawn as s, i (s.row.entry.key)}
        <div class="row" role="row" style:top="{(first + i) * CELL}px">
          {#each columns as c, k (c)}
            {@const rule = rules[c]}
            {#if rule}
              <span class="logo feature tile tone-{tileTone(s, c, modeOf(rule))}" class:muted={picked > 0 && k >= picked} role="gridcell" style:--icon={featureIconImage(rule.icon)}></span>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <div class="clip names">
    <div class="layer" style:transform="translate3d(0, {y}px, 0)">
      {#each names as s, i (s.row.entry.key)}
        {@const got = metCount(s, counted)}
        <div class="name" class:complete={picked > 0 && !s.need && !s.want} style:top="{(namesFirst + i) * CELL}px">
          <SourceIcon picture={s.row.entry.picture} />
          <span class="who">
            <span class="brand">{s.row.entry.brand}{#if s.row.entry.tag}<span class="dimtext sp">{s.row.entry.tag}</span>{/if}</span>
            <span class="bar" aria-hidden="true"><span class="fill" class:missing={s.need > 0} style:transform="scaleX({counted.length ? got / counted.length : 0})"></span></span>
          </span>
          <span class="count" class:missing={s.need > 0}>{got}/{counted.length}</span>
          <span class="sr-only"> — {words(s)}</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="clip head">
    <div class="layer" style:transform="translate3d({x}px, 0, 0)">
      {#each columns as c, k (c)}
        {@const rule = rules[c]}
        {#if rule}
          {@const href = featureHref(rule)}
          <svelte:element this={href ? "a" : "span"} {href} class="col" class:picked={k < picked} class:muted={picked > 0 && k >= picked} style:left="{k * CELL}px" title={rule.name} role="columnheader">
            <img src={featureIcon(rule.icon)} alt="" width="24" height="24" />
            <span class="short">{rule.short}</span>
          </svelte:element>
        {/if}
      {/each}
    </div>
  </div>
  <div class="corner">
    <ToneKey tones={["met", "offered", "unmet"]} />
    <b>Carrier</b>
  </div>

  {#if tip}<FeatureTip title={tip.title} tone={tip.tone} lines={tip.lines} left={tip.left} top={tip.top} onclose={() => (tip = null)} />{/if}
</div>

<style>
  .mx {
    --cell: 48px;
    --head: 66px;
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    overscroll-behavior: contain;
    user-select: none;
    -webkit-user-select: none;
    background: var(--desktop) var(--stipple) 0 0 / 4px 4px;
    image-rendering: pixelated;
    border: 2px solid;
    border-color: var(--shadow) var(--light) var(--light) var(--shadow);
    contain: strict;
    outline: none;
  }
  .mx:focus-visible {
    outline: 1px dotted var(--text);
    outline-offset: -4px;
  }
  .clip {
    position: absolute;
    overflow: hidden;
  }
  .cells {
    inset: var(--head) 0 0 var(--name-w);
  }
  .names {
    inset: var(--head) auto 0 0;
    width: var(--name-w);
    background: var(--field);
    border-right: 2px solid var(--shadow);
  }
  .head {
    inset: 0 0 auto var(--name-w);
    height: var(--head);
    background: var(--face);
    border-bottom: 2px solid var(--shadow);
  }
  .corner {
    position: absolute;
    inset: 0 auto auto 0;
    width: var(--name-w);
    height: var(--head);
    display: flex;
    flex-direction: column;
    justify-content: end;
    padding: 0 6px 4px;
    font-weight: bold;
    background: var(--face);
    border: solid var(--shadow);
    border-width: 0 2px 2px 0;
  }
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
  }
  .row {
    position: absolute;
    left: 0;
    display: flex;
    height: var(--cell);
  }
  /* The whole cell is the target; the badge sits inside it, so the backdrop shows between neighbours. */
  .tile {
    --logo: 36px;
    margin: 6px;
  }
  .muted {
    opacity: 0.35;
  }
  .name {
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    width: var(--name-w);
    height: var(--cell);
    padding: 0 6px;
    border-bottom: 1px solid #f0eee9;
  }
  /* Meeting every requirement earns a gold frame. */
  .name.complete {
    background: #fff8e0;
    box-shadow:
      inset 3px 0 0 #e0b030,
      inset 0 0 0 1px #e8d49a;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .brand {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    height: 6px;
    background: var(--face);
    border: 1px solid var(--shadow);
  }
  .fill {
    display: block;
    height: 100%;
    background: #e0b030;
    transform-origin: left;
  }
  .fill.missing {
    background: var(--shadow);
  }
  .count {
    font: bold 11px var(--mono);
    color: #6b4a00;
  }
  .count.missing {
    color: var(--text-dim);
  }
  .col {
    position: absolute;
    top: 0;
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 2px;
    width: var(--cell);
    height: var(--head);
    padding-top: 5px;
    border-right: 1px solid var(--shadow);
  }
  a.col {
    color: inherit;
    text-decoration: none;
  }
  a.col:hover .short {
    text-decoration: underline;
  }
  .col.picked {
    background: var(--face-hi);
    box-shadow: inset 0 -3px 0 var(--sel);
  }
  .short {
    font-size: 10px;
    line-height: 1.1;
    text-align: center;
    overflow-wrap: normal;
    hyphens: none;
  }
  .col.picked .short {
    font-weight: bold;
  }
</style>
