<script lang="ts">
  import type { Snippet } from "svelte";
  import { RULE_GROUP_NAMES } from "#lib/feature-matrix.ts";
  import { featureIconImage } from "#lib/feature-icons.ts";
  import type { FeatureGroup, FeatureNode } from "./tree.ts";

  interface Props {
    groups: readonly FeatureGroup[];
    /** What ends a node's line in place of its value. */
    tail?: Snippet<[FeatureNode]> | undefined;
    /** What a click on the line of a node `opens` accepts unfolds under it. */
    detail?: Snippet<[FeatureNode]> | undefined;
    opens?: ((n: FeatureNode) => boolean) | undefined;
  }

  /** Feature badges as a property list: one line each, a refinement indented under what it refines. A phone shows the top lines until one is unfolded. */
  let { groups, tail, detail, opens }: Props = $props();

  const PHONE = "(max-width: 760px)";
  /** A node's children's fold as clicked; unclicked, they show on a desktop and hide on a phone. */
  let folds = $state<Record<string, "folded" | "unfolded">>({});
  let opened = $state<Record<string, boolean>>({});

  function twist(id: string): void {
    const shown = matchMedia(PHONE).matches ? folds[id] === "unfolded" : folds[id] !== "folded";
    folds[id] = shown ? "folded" : "unfolded";
  }
</script>

{#snippet line(n: FeatureNode)}
  <span class="logo feature tone-{n.tone}" style:--icon={featureIconImage(n.icon)}></span>
  <span class="name" class:weak={!n.strong}>{n.name}</span>
  {#if tail}{@render tail(n)}{:else}<span class="value" title={n.words}>{n.words}</span>{/if}
{/snippet}

{#snippet node(n: FeatureNode)}
  {@const more = detail !== undefined && (opens?.(n) ?? false) ? detail : null}
  <li data-fold={folds[n.id]}>
    <div class="row">
      {#if n.children.length}
        <button type="button" class="twist" aria-label="Fold or unfold {n.name}" onclick={() => twist(n.id)}></button>
      {:else}
        <span class="twist" aria-hidden="true"></span>
      {/if}
      {#if more}
        <button type="button" class="line" aria-expanded={opened[n.id] ?? false} onclick={() => (opened[n.id] = !opened[n.id])}>{@render line(n)}</button>
      {:else if n.href !== null}
        <a class="line" href={n.href}>{@render line(n)}</a>
      {:else}
        <span class="line">{@render line(n)}</span>
      {/if}
    </div>
    {#if more && opened[n.id]}<div class="detail">{@render more(n)}</div>{/if}
    {#if n.children.length}
      <ul>{#each n.children as c (c.id)}{@render node(c)}{/each}</ul>
    {/if}
  </li>
{/snippet}

<div class="ftree" style:--lock={featureIconImage("lock")} style:--switch={featureIconImage("toggle")}>
  {#each groups as g (g.group)}
    <h3>{RULE_GROUP_NAMES[g.group]}</h3>
    <ul>{#each g.roots as r (r.id)}{@render node(r)}{/each}</ul>
  {/each}
</div>

<style>
  .ftree h3 {
    margin: 6px 0 1px;
  }
  .ftree h3:first-child {
    margin-top: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* Elbow connectors from the parent's badge, as the site's value trees draw them. */
  ul ul {
    margin-left: 23px;
    padding-left: 10px;
    border-left: 1px dotted var(--dark);
  }
  ul ul > li {
    position: relative;
  }
  ul ul > li::before {
    content: "";
    position: absolute;
    left: -10px;
    top: 11px;
    width: 8px;
    border-top: 1px dotted var(--dark);
  }
  .row {
    display: flex;
    align-items: center;
    min-height: 22px;
  }
  .row:hover {
    background: #eef2f7;
  }
  .twist {
    flex: none;
    width: 13px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-dim);
    font: 10px var(--ui);
    cursor: pointer;
  }
  button.twist::before {
    content: "▾";
  }
  li[data-fold="folded"] > .row button.twist::before {
    content: "▸";
  }
  li[data-fold="folded"] > ul {
    display: none;
  }
  .line {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 2px;
    color: inherit;
    text-decoration: none;
    font: inherit;
    text-align: left;
    background: none;
    border: 0;
  }
  button.line {
    cursor: pointer;
  }
  a.line:hover .name,
  button.line:hover .name {
    text-decoration: underline;
  }
  .logo.feature {
    --logo: 18px;
  }
  .name {
    flex: none;
    white-space: nowrap;
  }
  .weak {
    opacity: 0.6;
  }
  .value {
    flex: 1;
    min-width: 0;
    text-align: right;
    font: 11.5px var(--mono);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .detail {
    margin: 1px 0 4px 18px;
  }
  @media (max-width: 760px) {
    li:not([data-fold="unfolded"]) > ul {
      display: none;
    }
    li:not([data-fold="unfolded"]) > .row button.twist::before {
      content: "▸";
    }
    li[data-fold="unfolded"] > .row button.twist::before {
      content: "▾";
    }
    .row {
      min-height: 28px;
    }
    .twist {
      width: 20px;
      align-self: stretch;
      font-size: 13px;
    }
  }
</style>
