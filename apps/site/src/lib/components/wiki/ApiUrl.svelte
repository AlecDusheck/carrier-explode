<!-- A URL of the public API, linked, so an article names the API wherever it is served. -->
<script lang="ts">
  import { page } from "$app/state";

  let { path = "" }: { path?: string } = $props();

  const url = $derived(`${page.data.apiOrigin}${path}`);
</script>

<a href={url}><code>{url}</code></a>
