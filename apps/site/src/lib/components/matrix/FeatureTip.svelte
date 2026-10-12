<script lang="ts">
  import type { Tone } from "./score.ts";

  /** The matrix's one tooltip: a title bar in the cell's tone, then what it says. */
  let {
    title,
    tone,
    lines,
    left,
    top,
    onclose,
  }: { title: string; tone: Tone; lines: readonly string[]; left: number; top: number; onclose: () => void } = $props();
</script>

<div class="tip raised" role="tooltip" style:translate="{left}px {top}px">
  <!-- The matrix under it never sees a press on the close button, so it cannot also start a pan or a tap. -->
  <b class="bar tone-{tone}">{title}<button type="button" class="close bare" aria-label="Close" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={onclose}>×</button></b>
  {#each lines as line, i (i)}<span class:dimtext={i > 0}>{line}</span>{/each}
</div>

<style>
  .tip {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 4;
    display: grid;
    gap: 2px;
    width: 240px;
    padding: 0 0 5px;
    background: var(--field);
    box-shadow: 3px 3px 0 var(--drop);
    pointer-events: none;
  }
  .tip > span {
    padding: 0 7px;
  }
  .bar {
    display: flex;
    align-items: center;
    padding: 2px 0 2px 7px;
    margin-bottom: 2px;
    background: var(--tone-fill);
    border-bottom: 1px solid var(--tone-rim);
  }
  .close {
    margin-left: auto;
    width: 32px;
    height: 24px;
    font-size: 16px;
    line-height: 1;
    pointer-events: auto;
  }
</style>
