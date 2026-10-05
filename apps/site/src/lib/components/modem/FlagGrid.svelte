<script lang="ts">
  /** One-byte flags as a grid of their indices, set ones marked; `notes`: `<index>: <note>` per line, shown under the grid for set flags. */
  let { flags, notes }: { flags: readonly number[]; notes: string | null } = $props();

  const lines = $derived((notes ?? "").split("\n").flatMap((l) => {
    const m = /^(\d+): (.*)$/.exec(l);
    return m?.[1] === undefined || m[2] === undefined ? [] : [{ index: Number(m[1]), note: m[2] }];
  }));
  const noteOf = (i: number): string | undefined => lines.find((l) => l.index === i)?.note;
</script>

<div class="flags">
  {#each flags as value, index (index)}
    {@const note = noteOf(index)}
    <span class="flag" class:set={value !== 0} class:odd={value > 1} title="flag {index} = {value}{note ? '. ' + note : ''}">{index}</span>
  {/each}
</div>
{#each lines.filter((l) => flags[l.index]) as l (l.index)}
  <div class="flagnote"><b>{l.index}</b>: {l.note}</div>
{/each}

<style>
  .flags { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 3px; }
  .flag {
    font: 10px/16px var(--mono); width: 20px; text-align: center; color: var(--text-dim);
    border: 1px solid #c9c5bd; background: var(--field);
  }
  .flag.set { background: var(--good-bg); border-color: var(--good-border); color: var(--text); font-weight: bold; }
  .flag.odd { background: var(--warn-bg); border-color: var(--warn-border); }
  .flagnote { font: 11px var(--ui); color: var(--text-dim); }
</style>
