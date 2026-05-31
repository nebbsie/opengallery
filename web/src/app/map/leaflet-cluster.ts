import type * as Leaflet from 'leaflet';

// `leaflet.markercluster` is a classic Leaflet plugin: its UMD bundle does NOT
// import leaflet itself — it extends a *global* `L` (it runs
// `L.markerClusterGroup = ...`, `L.MarkerClusterGroup = L.FeatureGroup.extend(...)`).
// Under Angular's esbuild build the `leaflet` import is never published as
// `window.L`, so when the plugin evaluates there is nothing to extend and the
// component blows up with "c.markerClusterGroup is not a function".
//
// Fix: load leaflet, publish it as the global the plugin expects, and only THEN
// import the plugin so it extends the exact instance the component uses.
//
// Two subtleties this handles:
//  1. Order. A static `import 'leaflet.markercluster'` is hoisted above any
//     `window.L = ...` assignment in the same module, reintroducing the bug. A
//     dynamic `import()` runs after the assignment, so ordering is guaranteed.
//  2. Extensibility. An ES-module namespace object is frozen, and the plugin
//     adds new properties to `L` under "use strict", which throws on a frozen
//     object. We resolve to the (extensible) CJS/UMD export when present, and
//     otherwise copy the namespace into a plain extensible object before the
//     plugin extends it.
let leafletPromise: Promise<typeof Leaflet> | null = null;

export function loadLeafletWithCluster(): Promise<typeof Leaflet> {
  if (leafletPromise) return leafletPromise;

  leafletPromise = (async () => {
    const ns = await import('leaflet');
    // Prefer the UMD/CJS export (extensible); fall back to the namespace.
    const candidate = ((ns as unknown as { default?: unknown }).default ??
      ns) as typeof Leaflet;
    const L: typeof Leaflet = Object.isExtensible(candidate)
      ? candidate
      : ({ ...candidate } as typeof Leaflet);

    (globalThis as unknown as { L: typeof Leaflet }).L = L;

    // Side-effect import: extends the global `L` we just published.
    await import('leaflet.markercluster');

    return L;
  })();

  return leafletPromise;
}
