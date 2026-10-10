<script lang="ts">
  import type { Requirement, Rule, RuleId } from "#lib/feature-matrix.ts";
  import { link } from "#lib/format.ts";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import FeatureTree from "./FeatureTree.svelte";
  import type { Scored } from "./score.ts";
  import { ruleTree } from "./tree.ts";

  /** One carrier's rules as a tree: each group, and under a rule the rules that refine it. */
  let { scored, rules, reqs, onclose }: { scored: Scored; rules: readonly Rule[]; reqs: ReadonlyMap<RuleId, Requirement>; onclose: () => void } = $props();

  const entry = $derived(scored.row.entry);
</script>

<div class="panel" role="dialog" aria-label="{entry.brand} features">
  <div class="titlebar">
    <SourceIcon picture={entry.picture} />
    <span class="grow">{entry.brand}{#if entry.tag}<span class="sub sp">{entry.tag}</span>{/if}</span>
    <button type="button" class="btn" aria-label="Close" onclick={onclose}>×</button>
  </div>
  <div class="scroll pad">
    <p class="flush">
      {#if scored.need || scored.want}Misses {scored.need} required and {scored.want} nice to have.{:else}Meets every requirement.{/if}
      <a href={link(entry.path)}>Open {entry.name}</a>
    </p>
    <FeatureTree groups={ruleTree(scored, rules, reqs)} />
  </div>
</div>

<style>
  .panel {
    position: absolute;
    z-index: 5;
    inset: 4px 4px 4px auto;
    width: min(340px, calc(100% - 8px));
    display: flex;
    flex-direction: column;
    background: var(--face);
    border: 2px solid;
    border-color: var(--light) var(--dark) var(--dark) var(--light);
    box-shadow: 4px 4px 0 rgb(0 0 0 / 0.3);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .titlebar .btn {
    min-height: 20px;
    padding: 0 7px;
  }
  @media (max-width: 760px) {
    .panel {
      inset: auto 0 0 0;
      width: auto;
      max-height: 62%;
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
</style>
