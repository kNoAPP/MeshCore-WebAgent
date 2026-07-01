// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMeshStore } from '@/store/meshStore';
import { collectMapNodes, selfMapNode, type MapNode } from '@/lib/map/nodes';
import {
  DEFAULT_MAP_PREFS,
  MAP_MARKER_SIZE_PX,
  MAX_MAP_MARKERS,
  TILE_ATTRIBUTION,
  TILE_URLS,
  type MapPrefs,
} from '@/lib/map/config';
import {
  FAVORITE_OUTLINE,
  FAVORITE_OUTLINE_WIDTH,
  LEGEND_CATEGORIES,
  MARKER_STYLES,
  markerStyle,
  shapeSvg,
} from '@/lib/map/markers';

/**
 * The single-world extent, in decimal degrees. Longitude spans the full globe;
 * latitude is clamped to the Web Mercator limit (±85.05113°) so the bounds line
 * up exactly with the tile grid's top and bottom edges — no blank strip at the
 * poles.
 */
const WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85.05112878, -180],
  [85.05112878, 180],
];

/** Escapes a string for safe insertion into marker/tooltip HTML. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  );
}

/**
 * Builds a `divIcon` for a node — category shape/color, self ringed, and a
 * gold border on favorited contacts.
 */
function nodeIcon(node: MapNode): L.DivIcon {
  const { shape, color } = markerStyle(node.advType);
  const cls =
    node.kind === 'self' ? 'map-marker map-marker-self' : 'map-marker';
  const size = MAP_MARKER_SIZE_PX;
  const svg = node.favorite
    ? shapeSvg(shape, color, size, FAVORITE_OUTLINE, FAVORITE_OUTLINE_WIDTH)
    : shapeSvg(shape, color, size);
  return L.divIcon({
    html: `<div class="${cls}" style="width:${size}px;height:${size}px">${svg}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * The opening viewport: either a fixed `center`/`zoom`, or a set of `bounds`
 * (one `[lat, lon]` per node) to frame with {@link L.Map.fitBounds}.
 */
type StartView =
  | { center: [number, number]; zoom: number }
  | { bounds: [number, number][] };

/**
 * Picks the starting viewport: the persisted center/zoom if the user has panned
 * before; otherwise a close-in view on this node, or — when this node reports
 * no fix — bounds framing every located contact/advert, falling back to the
 * whole world when none have a location.
 */
function initialView(
  prefs: MapPrefs | null,
  self: MapNode | null,
  nodes: MapNode[],
): StartView {
  if (prefs) return { center: prefs.center, zoom: prefs.zoom };
  if (self) return { center: [self.lat, self.lon], zoom: 11 };
  if (nodes.length > 0) return { bounds: nodes.map((n) => [n.lat, n.lon]) };
  return { center: DEFAULT_MAP_PREFS.center, zoom: DEFAULT_MAP_PREFS.zoom };
}

/**
 * Desktop map view: plots this node and every located contact/advert on a
 * single online raster basemap (CARTO Positron/Dark Matter, matching the app
 * theme). When this node has no GPS fix, the map still opens — framed to fit
 * every located contact/advert, or the whole world when none have a location.
 */
export function MapView() {
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const contacts = useMeshStore((s) => s.contacts);
  const adverts = useMeshStore((s) => s.adverts);

  const self = useMemo(() => selfMapNode(selfInfo), [selfInfo]);
  const nodes = useMemo(
    () => collectMapNodes(contacts, adverts, self?.pubkeyPrefix),
    [contacts, adverts, self?.pubkeyPrefix],
  );

  return <LeafletMap self={self} nodes={nodes} />;
}

/** The interactive Leaflet map; this node's marker shows when located. */
function LeafletMap({
  self,
  nodes,
}: {
  self: MapNode | null;
  nodes: MapNode[];
}) {
  const { t } = useTranslation();
  const theme = useMeshStore((s) => s.theme);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Capture the opening viewport once, from the first render's state.
  const [startView] = useState(() =>
    initialView(useMeshStore.getState().mapPrefs, self, nodes),
  );
  // When on, only favorited contacts (plus this node) are plotted.
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // The nodes actually eligible for plotting, after the favorites-only filter.
  // Both the marker layer and the cap banner derive from this so their counts
  // never disagree.
  const visible = useMemo(
    () => (favoritesOnly ? nodes.filter((n) => n.favorite) : nodes),
    [nodes, favoritesOnly],
  );

  // Create the map once. The persist-on-move handler reads live store state via
  // getState(), so the effect needs no reactive deps.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      // Lock to a single world so markers (which Leaflet renders only on the
      // primary copy) can't disagree with a basemap repeated at low zoom. The
      // opening viewport is applied below, once the min zoom is known.
      maxBounds: WORLD_BOUNDS,
      maxBoundsViscosity: 1,
    });
    mapRef.current = map;

    // Never let the viewport show blank space around the world: the minimum
    // zoom is the smallest level at which the world still covers the whole
    // container, recomputed whenever the container resizes.
    const clampMinZoom = () => {
      map.setMinZoom(map.getBoundsZoom(WORLD_BOUNDS, true));
    };
    clampMinZoom();
    map.on('resize', clampMinZoom);

    // Apply the opening viewport now, before the persist handler is wired, so
    // this programmatic move never writes prefs for a user who hasn't panned.
    // The `bounds` case frames every located node; `maxZoom` keeps a single
    // node (or a tight cluster) from slamming all the way to street level.
    if ('bounds' in startView) {
      map.fitBounds(startView.bounds, { padding: [40, 40], maxZoom: 13 });
    } else {
      map.setView(startView.center, startView.zoom);
    }

    markerLayerRef.current = L.layerGroup().addTo(map);

    // `noWrap` keeps the basemap to one world (matching the bounded view);
    // `detectRetina` swaps in `@2x` tiles (via the `{r}` token) on hi-DPI
    // displays so labels stay crisp under the app's 1.25 CSS zoom.
    tileLayerRef.current = L.tileLayer(
      TILE_URLS[useMeshStore.getState().theme],
      {
        attribution: TILE_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: 20,
        noWrap: true,
        detectRetina: true,
      },
    ).addTo(map);

    const persist = () => {
      const c = map.getCenter();
      useMeshStore.getState().setMapPrefs({
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', persist);

    return () => {
      map.off('moveend', persist);
      map.off('resize', clampMinZoom);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, [startView]);

  // Point the single tile layer at the active theme's CARTO style; light/dark
  // just swaps the URL template, avoiding a remove/re-add flash.
  useEffect(() => {
    tileLayerRef.current?.setUrl(TILE_URLS[theme]);
  }, [theme]);

  // Rebuild markers when the located node set changes.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const all = self ? [self, ...visible] : visible;
    for (const node of all.slice(0, MAX_MAP_MARKERS)) {
      const marker = L.marker([node.lat, node.lon], { icon: nodeIcon(node) });
      const label =
        node.kind === 'self' ? t('map.self') : escapeHtml(node.name);
      marker.bindTooltip(label, { direction: 'top' });
      if (node.kind === 'contact') {
        const id = node.pubkeyPrefix;
        marker.on('click', () =>
          useMeshStore.getState().setManagePanel({ kind: 'contact', id }),
        );
      }
      marker.addTo(layer);
    }
  }, [self, visible, t]);

  const total = visible.length + (self ? 1 : 0);
  const capped = total > MAX_MAP_MARKERS;

  return (
    <div className='meshcore-map relative isolate flex-1'>
      <div ref={containerRef} className='absolute inset-0' />
      <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-col items-start gap-2 p-3'>
        {capped && (
          <span className='pointer-events-auto rounded-md border border-(--border) bg-(--surface)/90 px-2.5 py-1 text-xs text-(--text2) backdrop-blur'>
            {t('map.markerCap', { shown: MAX_MAP_MARKERS, total })}
          </span>
        )}
      </div>
      <MapLegend
        favoritesOnly={favoritesOnly}
        onToggleFavoritesOnly={() => setFavoritesOnly((v) => !v)}
      />
    </div>
  );
}

/**
 * A collapsible key, pinned to the map's bottom-right corner, pairing each node
 * category with the colored shape used to plot it, plus a switch to limit the
 * map to favorited contacts. Collapsed state is transient UI, so it lives in
 * local component state rather than the store.
 *
 * @param favoritesOnly - whether the map is currently filtered to favorites.
 * @param onToggleFavoritesOnly - flips the favorites-only filter.
 */
function MapLegend({
  favoritesOnly,
  onToggleFavoritesOnly,
}: {
  favoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div className='pointer-events-auto absolute right-3 bottom-8 z-1000 overflow-hidden rounded-md border border-(--border) bg-(--surface)/90 text-(--text) backdrop-blur'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs font-semibold tracking-wide text-(--text2) uppercase hover:text-(--accent)'
      >
        {t('map.legend.title')}
        <Chevron open={open} />
      </button>
      {open && (
        <>
          <ul className='flex flex-col gap-1.5 px-2.5 pt-0.5 pb-2'>
            {LEGEND_CATEGORIES.map((category) => {
              const style = MARKER_STYLES[category];
              return (
                <li
                  key={category}
                  className='flex items-center gap-2 text-xs whitespace-nowrap'
                >
                  <span
                    className='flex h-3.5 w-3.5 shrink-0 items-center justify-center'
                    aria-hidden='true'
                    dangerouslySetInnerHTML={{
                      __html: shapeSvg(style.shape, style.color, 14),
                    }}
                  />
                  {t(style.labelKey)}
                </li>
              );
            })}
          </ul>
          <button
            type='button'
            role='switch'
            aria-checked={favoritesOnly}
            onClick={onToggleFavoritesOnly}
            className='flex w-full items-center justify-between gap-3 border-t border-(--border) px-2.5 py-2 text-xs whitespace-nowrap hover:text-(--accent)'
          >
            <span>{t('map.legend.favoritesOnly')}</span>
            <span
              className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
              style={{
                background: favoritesOnly ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
                  favoritesOnly ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

/** Caret that flips to indicate the legend's expanded/collapsed state. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox='0 0 16 16'
      className={`h-3 w-3 transition-transform ${open ? '' : 'rotate-180'}`}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M4 10l4-4 4 4' />
    </svg>
  );
}
