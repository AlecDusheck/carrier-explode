<script lang="ts">
  import { page } from "$app/state";
  import { link } from "#lib/format.ts";
</script>

<div class="view">
  <div class="scroll pad">
    <div class="banner err">{page.status} &middot; {page.error?.message}</div>
    <a class="btn" href={link("/carriers")}>Carriers</a>
  </div>
</div>
