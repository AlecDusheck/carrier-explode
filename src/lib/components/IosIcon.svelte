<script lang="ts" module>
  /**
   * Each iOS release's mark, drawn here after Apple's (developer.apple.com's
   * version icons, colours sampled from them): iOS 13 to 15 are a gradient
   * numeral on white; from 16 the gradient fills the tile and the numeral is
   * light on top. `dir` runs the gradient from (x1, y1) to (x2, y2) across the tile.
   */
  type Mark = { stops: string[]; dir: [number, number, number, number]; on: "white" | "tile"; ink?: string; glass?: boolean };

  const MARKS: Record<number, Mark> = {
    13: { on: "white", dir: [0, 0, 0, 1], stops: ["#fead14", "#fb860e", "#f46331", "#dd3d5e", "#4b1162"] },
    14: { on: "white", dir: [0, 0, 1, 1], stops: ["#f6af2b", "#f5822f", "#e44243", "#be559e", "#5962a4"] },
    15: { on: "white", dir: [0.3, 0, 0.7, 1], stops: ["#fd9c11", "#ffb308", "#76a6d4", "#3c5166"] },
    16: { on: "tile", dir: [1, 0, 0, 1], stops: ["#0080a0", "#058499", "#599d92", "#bba670", "#d19f4a"], ink: "#ffffff" },
    17: { on: "tile", dir: [0, 0, 0, 1], stops: ["#ff0000", "#ff5916", "#ff7105", "#f84c6a", "#d549e9"], ink: "#ffffff" },
    18: { on: "tile", dir: [0, 0, 1, 0], stops: ["#003b53", "#155f77", "#4397aa", "#a3b1c2", "#ffb2bb"], ink: "#e1ffff" },
    26: { on: "tile", dir: [1, 0, 0, 1], stops: ["#2e5fc3", "#4f84dd", "#72bedb", "#65d2cf", "#95e1db"], ink: "#ffffff", glass: true },
    27: { on: "tile", dir: [0, 0, 1, 1], stops: ["#9d7f58", "#b7a38b", "#9e8e7f", "#847676", "#757383"], ink: "#fffcf5", glass: true },
  };
  /** A release with no mark of its own here. */
  const PLAIN: Mark = { on: "tile", dir: [0, 0, 0, 1], stops: ["#8e8e93", "#636366"], ink: "#ffffff" };
</script>

<script lang="ts">
  /** `version` as the site writes it: "27.0.1", "27.2 beta 2", "27.0" (an OTA's minimum). */
  let { version }: { version?: string } = $props();

  const id = $props.id();
  const major = $derived(version ? Number.parseInt(version, 10) : NaN);
  const mark = $derived(MARKS[major] ?? PLAIN);
  const fill = $derived(`url(#g${id})`);
</script>

<svg class="ios-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <defs>
    <linearGradient id="g{id}" x1={mark.dir[0]} y1={mark.dir[1]} x2={mark.dir[2]} y2={mark.dir[3]}>
      {#each mark.stops as c, i (i)}<stop offset={i / (mark.stops.length - 1)} stop-color={c} />{/each}
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill={mark.on === "white" ? "#fff" : fill} stroke={mark.on === "white" ? "#d1d1d6" : "none"} />
  {#if Number.isFinite(major)}
    <!-- Apple's numerals are hairline-thin; a little heavier stays legible at 20px. -->
    <text
      x="12" y="12.6" text-anchor="middle" dominant-baseline="central"
      font-size={String(major).length > 1 ? 14 : 17} font-weight={mark.glass ? 600 : 400} letter-spacing="-0.6"
      font-family="-apple-system, system-ui, sans-serif"
      fill={mark.on === "white" ? fill : mark.ink}
      fill-opacity={mark.glass ? 0.85 : 1}
    >{major}</text>
  {/if}
</svg>
