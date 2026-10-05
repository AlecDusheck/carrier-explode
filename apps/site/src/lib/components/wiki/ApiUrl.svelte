<!-- A URL of the public API, linked, so an article names the API wherever it is served. -->
<script lang="ts">
  import { API_ORIGIN } from "#lib/public-api.ts";

  let { path = "" }: { path?: string } = $props();

  const url = $derived(`${API_ORIGIN}${path}`);
</script>

<a href={url}><code>{url}</code></a>
