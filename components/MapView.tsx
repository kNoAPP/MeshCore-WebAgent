// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { useMeshStore } from '@/store/meshStore';
import { ADV_ICON } from '@/lib/utils';
import {
  averageCenter,
  collectMapNodes,
  selfMapNode,
  type MapNode,
} from '@/lib/map/nodes';
import {
  DEFAULT_MAP_PREFS,
  MAX_MAP_MARKERS,
  OFFLINE_BASEMAP_URL,
  TILE_ATTRIBUTION,
  TILE_URLS,
  type MapPrefs,
} from '@/lib/map/config';
import { warmOfflineTiles } from '@/lib/map/tileWarmup';

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

/** Builds a `divIcon` for a node — its advert-type emoji, self ringed. */
function nodeIcon(node: MapNode): L.DivIcon {
  const emoji = ADV_ICON[node.advType] ?? '👤';
  const cls =
    node.kind === 'self' ? 'map-marker map-marker-self' : 'map-marker';
  return L.divIcon({
    html: `<div class="${cls}"><span>${emoji}</span></div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/**
 * Picks the starting viewport: the persisted center/zoom if the user has panned
 * before; otherwise a close-in view on this node, or — when this node reports
 * no fix — the average of located contacts/adverts, falling back to the whole
 * world when none have a location.
 */
function initialView(
  prefs: MapPrefs,
  self: MapNode | null,
  nodes: MapNode[],
): { center: [number, number]; zoom: number } {
  const untouched =
    prefs.center[0] === DEFAULT_MAP_PREFS.center[0] &&
    prefs.center[1] === DEFAULT_MAP_PREFS.center[1] &&
    prefs.zoom === DEFAULT_MAP_PREFS.zoom;
  if (!untouched) return { center: prefs.center, zoom: prefs.zoom };
  if (self) return { center: [self.lat, self.lon], zoom: 11 };
  const avg = averageCenter(nodes);
  if (avg) return { center: avg, zoom: 11 };
  return { center: DEFAULT_MAP_PREFS.center, zoom: DEFAULT_MAP_PREFS.zoom };
}

/**
 * Desktop map view: plots this node and every located contact/advert on a
 * single raster basemap (CARTO). The service worker streams tiles from the
 * network when online — caching them as it goes — and serves the cached copy
 * when offline, so the map "just works" in both states with no toggle.
 * A bundled vector world outline sits beneath the tiles, showing country shapes
 * wherever cached tiles are missing offline. When this node has no GPS fix, the
 * map still opens — centered on the average of located contacts/adverts, or the
 * whole world when none have a location.
 */
export function MapView() {
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const contacts = useMeshStore((s) => s.contacts);
  const adverts = useMeshStore((s) => s.adverts);

  const self = useMemo(() => selfMapNode(selfInfo), [selfInfo]);
  const nodes = useMemo(
    () => collectMapNodes(contacts, adverts),
    [contacts, adverts],
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
  const isOnline = useMeshStore((s) => s.isOnline);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Capture the opening viewport once, from the first render's state.
  const [startView] = useState(() =>
    initialView(useMeshStore.getState().mapPrefs, self, nodes),
  );

  // Create the map once, with the bundled vector world outline as the bottom
  // layer. The persist-on-move handler reads live store state via getState(),
  // so the effect needs no reactive deps.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: startView.center,
      zoom: startView.zoom,
      worldCopyJump: true,
    });
    mapRef.current = map;

    // A pane below the tile pane (z-index 200) so the vector outline shows
    // through wherever raster tiles are missing (offline gaps) yet stays hidden
    // behind tiles when they are present.
    map.createPane('vectorBase');
    const pane = map.getPane('vectorBase');
    if (pane) pane.style.zIndex = '150';

    markerLayerRef.current = L.layerGroup().addTo(map);

    void (async () => {
      try {
        const res = await fetch(OFFLINE_BASEMAP_URL);
        const topo = (await res.json()) as Topology;
        const geo = feature(
          topo,
          topo.objects.countries as GeometryCollection,
        ) as FeatureCollection;
        if (!mapRef.current) return;
        L.geoJSON(geo, {
          pane: 'vectorBase',
          interactive: false,
          style: () => ({ className: 'map-land', weight: 0.6 }),
        }).addTo(map);
      } catch {}
    })();

    const persist = () => {
      const c = map.getCenter();
      useMeshStore.getState().setMapPrefs({
        ...useMeshStore.getState().mapPrefs,
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      });
    };
    map.on('moveend', persist);

    return () => {
      map.off('moveend', persist);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, [startView]);

  // (Re)create the raster tile layer for the active theme; light/dark just
  // points it at the other CARTO style. Tiles are fetched at @2x (see
  // TILE_URLS) and drawn in the default 256 px slots so they stay sharp under
  // the 1.25 CSS zoom. The service worker decides network vs. cache, so the one
  // layer serves both online and offline with no switching here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.tileLayer(TILE_URLS[theme], {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      if (tileLayerRef.current === layer) tileLayerRef.current = null;
    };
  }, [theme]);

  // While online, upgrade the visible tiles to full resolution (a reconnect
  // re-requests them) and warm the offline cache for places not yet browsed.
  useEffect(() => {
    if (!isOnline) return;
    tileLayerRef.current?.redraw();
    warmOfflineTiles();
  }, [isOnline]);

  // Rebuild markers when the located node set changes.
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const all = self ? [self, ...nodes] : nodes;
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
  }, [self, nodes, t]);

  const total = nodes.length + (self ? 1 : 0);
  const capped = total > MAX_MAP_MARKERS;

  return (
    <div className='meshcore-map relative isolate flex-1'>
      <div ref={containerRef} className='absolute inset-0' />
      <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-col items-start gap-2 p-3'>
        {!isOnline && (
          <span className='pointer-events-auto rounded-md border border-(--border) bg-(--surface)/90 px-2.5 py-1 text-xs text-(--text2) backdrop-blur'>
            {t('map.offlineBadge')}
          </span>
        )}
        {capped && (
          <span className='pointer-events-auto rounded-md border border-(--border) bg-(--surface)/90 px-2.5 py-1 text-xs text-(--text2) backdrop-blur'>
            {t('map.markerCap', { shown: MAX_MAP_MARKERS, total })}
          </span>
        )}
      </div>
    </div>
  );
}
