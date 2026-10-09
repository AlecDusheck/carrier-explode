<script lang="ts">
  import { MODE_NAMES, MODES, RULE_GROUP_NAMES, RULE_GROUPS, ruleWhat, type Requirement, type Rule, type RuleId } from "#lib/feature-matrix.ts";
  import PixelIcon from "./PixelIcon.svelte";

  /** Each rule off, nice to have or required, with its parameter when it has one. */
  let {
    rules,
    reqs,
    onchange,
  }: {
    rules: readonly Rule[];
    reqs: ReadonlyMap<RuleId, Requirement>;
    onchange: (id: RuleId, req: Requirement) => void;
  } = $props();

  const groups = $derived(RULE_GROUPS.map((g) => ({ g, rules: rules.filter((r) => r.group === g) })).filter((x) => x.rules.length));
  const off: Requirement = { mode: "off", param: "" };
</script>

{#each groups as { g, rules: inGroup } (g)}
  <fieldset class="hgroup">
    <legend>{RULE_GROUP_NAMES[g]}</legend>
    {#each inGroup as rule (rule.id)}
      {@const req = reqs.get(rule.id) ?? off}
      <div class="req" class:on={req.mode !== "off"}>
        <PixelIcon name={rule.icon} size={16} />
        <span class="name" title={ruleWhat(rule)}>{rule.name}</span>
        <select aria-label="{rule.name}: how much it matters" value={req.mode} onchange={(e) => onchange(rule.id, { ...req, mode: MODES.find((m) => m === e.currentTarget.value) ?? "off" })}>
          {#each MODES as m (m)}<option value={m}>{MODE_NAMES[m]}</option>{/each}
        </select>
        {#if req.mode !== "off" && rule.param}
          <span class="param">
            {#if rule.param.kind === "choice"}
              <select aria-label="{rule.name}: which" value={req.param} onchange={(e) => onchange(rule.id, { ...req, param: e.currentTarget.value })}>
                {#each rule.param.options as [value, label] (value)}<option {value}>{label}</option>{/each}
              </select>
            {:else}
              <input type="text" aria-label="{rule.name}: equals" value={req.param} onchange={(e) => onchange(rule.id, { ...req, param: e.currentTarget.value })} />
            {/if}
          </span>
        {/if}
      </div>
    {/each}
  </fieldset>
{/each}

<style>
  .req {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 2px 6px;
    padding: 2px 0;
  }
  .req.on .name {
    font-weight: bold;
  }
  .name {
    min-width: 0;
  }
  .param {
    grid-column: 2 / -1;
    display: flex;
    justify-content: end;
  }
  fieldset.hgroup {
    margin: 0 0 8px;
  }
</style>
