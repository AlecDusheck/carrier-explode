<script lang="ts">
  import { phoneShape } from "#lib/phoneshapes.ts";

  /** A phone drawn from the back, from its measured shape; a plain outline for a model without one. */
  let { name }: { name?: string } = $props();

  const id = $props.id();
  const shape = $derived(phoneShape(name));
  // The body fills the 24-unit tile's height, centred; every part is placed as a fraction of it.
  const H = 22;
  const W = $derived(shape ? H / shape.aspect : 0);
  const ox = $derived((24 - W) / 2);
  const X = (f: number) => ox + f * W;
  const Y = (f: number) => 1 + f * H;
</script>

{#if shape}
  <svg class="phone-img" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <defs>
      <clipPath id="b{id}"><rect x={ox} y="1" width={W} height={H} rx={shape.radius * W} /></clipPath>
    </defs>
    <rect x={ox} y="1" width={W} height={H} rx={shape.radius * W} fill={shape.color} stroke="#8e8e93" stroke-width="0.6" />
    <g clip-path="url(#b{id})">
      {#if shape.module}
        {@const m = shape.module}
        <rect x={X(m.x)} y={Y(m.y)} width={m.w * W} height={m.h * H} rx={m.radius * W} fill={m.color} stroke="#8e8e93" stroke-width="0.3" />
      {/if}
      {#each shape.lenses as [x, y, d], i (i)}
        <circle cx={X(x)} cy={Y(y)} r={(d * W) / 2} fill="#2c2c2e" stroke="#636366" stroke-width="0.25" />
      {/each}
      {#each shape.extras ?? [] as [kind, x, y, d], i (i)}
        <circle cx={X(x)} cy={Y(y)} r={(d * W) / 2} fill={kind === "flash" ? "#fff4cc" : "#1c1c1e"} />
      {/each}
    </g>
  </svg>
{:else}
  <svg class="phone-img" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="6.5" y="2" width="11" height="20" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55" />
    <rect x="10" y="3.6" width="4" height="1.2" rx="0.6" fill="currentColor" opacity="0.55" />
  </svg>
{/if}
