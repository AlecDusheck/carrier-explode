<script lang="ts">
  import type { Snippet } from "svelte";

  /** An Overview's sections beside its features on a desktop; on a phone, the features first, folded to their top lines. */
  let { side, children }: { side: Snippet; children: Snippet } = $props();
</script>

<div class="fits">
  <div class="columns">
    <div class="main">{@render children()}</div>
    <aside>{@render side()}</aside>
  </div>
</div>

<style>
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    gap: 0 10px;
    align-items: start;
  }
  .main {
    min-width: 0;
  }
  /* The page's own width decides on a phone; beside the carrier list, the room left does. */
  .fits {
    container-type: inline-size;
  }
  @media (max-width: 760px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
    aside {
      order: -1;
    }
  }
  @container (width < 640px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
    aside {
      order: -1;
    }
  }
</style>
