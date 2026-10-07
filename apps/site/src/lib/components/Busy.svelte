<script module lang="ts">
  const WORDING = {
    index: "Waiting for index…",
    update: "Re-exploding…",
    page: "Exploding the page…",
    decode: (name: string) => `Exploding ${name}…`,
    scan: (name: string) => `Blasting through ${name}…`,
    diff: (name: string) => `Colliding ${name}…`,
  } as const;

  type Wording = typeof WORDING;
  type Named = { [K in keyof Wording]: Wording[K] extends string ? never : K }[keyof Wording];

  /** What the site waits on: the index, a refresh, a page, or something named that is decoded, scanned or diffed. */
  export type Awaiting = { readonly kind: Exclude<keyof Wording, Named> } | { readonly kind: Named; readonly name: string };

  export const busyText = (a: Awaiting): string => ("name" in a ? WORDING[a.kind](a.name) : WORDING[a.kind]);
</script>

<script lang="ts">
  let { awaiting }: { awaiting: Awaiting } = $props();
</script>

<span class="busy" role="status"><span class="busy-spin" aria-hidden="true"></span>{busyText(awaiting)}</span>
