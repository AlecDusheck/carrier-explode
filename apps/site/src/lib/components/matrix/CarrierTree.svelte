<script lang="ts">
  import { RULE_GROUP_NAMES, RULE_GROUPS, type Requirement, type Rule, type RuleId } from "#lib/feature-matrix.ts";
  import { link } from "#lib/format.ts";
  import { iconUrl } from "#lib/pixel-icons.ts";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import { cellWords, toneOf, type Scored } from "./score.ts";

  /** One carrier's rules as a tree: each group, and under a rule the rules that refine it. */
  let { scored, rules, reqs, onclose }: { scored: Scored; rules: readonly Rule[]; reqs: ReadonlyMap<RuleId, Requirement>; onclose: () => void } = $props();

  const ids = $derived(new Set<string>(rules.map((r) => r.id)));
  const childrenOf = (parent: string | null, group: string): number[] =>
    rules.flatMap((r, i) => (r.group === group && (r.under !== null && ids.has(r.under) ? r.under : null) === parent ? [i] : []));
  const groups = $derived(RULE_GROUPS.filter((g) => rules.some((r) => r.group === g)));
  const entry = $derived(scored.row.entry);
</script>

{#snippet node(i: number)}
  {@const rule = rules[i]}
  {#if rule}
    {@const mode = reqs.get(rule.id)?.mode ?? "off"}
    {@const outcome = scored.outcomes[i] ?? null}
    {@const kids = childrenOf(rule.id, rule.group)}
    <li>
      <span class="node" class:picked={mode !== "off"}>
        <span class="logo feature tile tone-{toneOf(outcome, mode, scored.cells[i] ?? 'unknown')}" style:--icon={iconUrl(rule.icon)}></span>
        <span class="text"><b>{rule.name}</b> <span class="dimtext">{cellWords(scored.cells[i] ?? "unknown")}</span></span>
      </span>
      {#if kids.length}
        <ul>{#each kids as k (k)}{@render node(k)}{/each}</ul>
      {/if}
    </li>
  {/if}
{/snippet}

<div class="panel" role="dialog" aria-label="{entry.brand} features" style:--lock={iconUrl("lock")} style:--switch={iconUrl("toggle")}>
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
    {#each groups as g (g)}
      <fieldset class="hgroup">
        <legend>{RULE_GROUP_NAMES[g]}</legend>
        <ul class="tree-root">{#each childrenOf(null, g) as i (i)}{@render node(i)}{/each}</ul>
      </fieldset>
    {/each}
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
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Elbow connectors, as the site's value trees draw them. */
  ul ul {
    margin-left: 13px;
    padding-left: 12px;
    border-left: 1px dotted var(--dark);
  }
  ul ul > li {
    position: relative;
  }
  ul ul > li::before {
    content: "";
    position: absolute;
    left: -12px;
    top: 15px;
    width: 10px;
    border-top: 1px dotted var(--dark);
  }
  .node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    opacity: 0.6;
  }
  .node.picked {
    opacity: 1;
  }
  .text {
    min-width: 0;
  }
  .tile {
    --logo: 28px;
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
