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
 * Desktop map view: plots this node and every located contact/advert. Renders a
 * live slippy map (online, after a one-time tile-host consent) or the bundled
 * offline outline (offline, when forced, or before consent). When this node has
 * no GPS fix, the map still opens — centered on the average of located
 * contacts/adverts, or the whole world when none have a location.
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
  const mapPrefs = useMeshStore((s) => s.mapPrefs);
  const setMapPrefs = useMeshStore((s) => s.setMapPrefs);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const basemapRef = useRef<L.Layer | null>(null);
  const geoRef = useRef<FeatureCollection | null>(null);
  // Capture the opening viewport once, from the first render's state.
  const [startView] = useState(() =>
    initialView(useMeshStore.getState().mapPrefs, self, nodes),
  );

  const useOnlineTiles =
    isOnline && !mapPrefs.forceOffline && mapPrefs.onlineTilesConsented;
  const needsConsent =
    isOnline && !mapPrefs.forceOffline && !mapPrefs.onlineTilesConsented;

  // Create the map once. The persist-on-move handler reads live store state via
  // getState(), so the effect needs no reactive deps.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: startView.center,
      zoom: startView.zoom,
      worldCopyJump: true,
    });
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);

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
      basemapRef.current = null;
    };
  }, [startView]);

  // Swap the basemap whenever connectivity, the offline override, consent, or
  // the theme changes. The marker layer is untouched, so node positions persist
  // across the swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const swap = (layer: L.Layer) => {
      if (cancelled) return;
      if (basemapRef.current) map.removeLayer(basemapRef.current);
      layer.addTo(map);
      basemapRef.current = layer;
    };

    if (useOnlineTiles) {
      swap(
        // Tiles are fetched at @2x (see TILE_URLS) and drawn in the default
        // 256 px slots, so they stay sharp under the 1.25 CSS zoom.
        L.tileLayer(TILE_URLS[theme], {
          attribution: TILE_ATTRIBUTION,
          subdomains: 'abcd',
          maxZoom: 19,
        }),
      );
    } else {
      void (async () => {
        let geo = geoRef.current;
        if (!geo) {
          try {
            const res = await fetch(OFFLINE_BASEMAP_URL);
            const topo = (await res.json()) as Topology;
            geo = feature(
              topo,
              topo.objects.countries as GeometryCollection,
            ) as FeatureCollection;
            geoRef.current = geo;
          } catch {
            return;
          }
        }
        swap(
          L.geoJSON(geo, {
            interactive: false,
            style: () => ({ className: 'map-land', weight: 0.6 }),
          }),
        );
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [useOnlineTiles, theme]);

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
      <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-wrap items-start justify-between gap-2 p-3'>
        <div className='flex flex-col gap-2'>
          {!useOnlineTiles && (
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
        <button
          onClick={() =>
            setMapPrefs({ ...mapPrefs, forceOffline: !mapPrefs.forceOffline })
          }
          className='pointer-events-auto rounded-md border border-(--border-control) bg-(--surface)/90 px-2.5 py-1 text-xs text-(--text2) backdrop-blur transition-colors hover:border-(--accent) hover:text-(--accent)'
        >
          {mapPrefs.forceOffline
            ? t('map.useOnlineMap')
            : t('map.useOfflineMap')}
        </button>
      </div>
      {needsConsent && (
        <TileConsent
          onAccept={() =>
            setMapPrefs({ ...mapPrefs, onlineTilesConsented: true })
          }
          onDecline={() => setMapPrefs({ ...mapPrefs, forceOffline: true })}
        />
      )}
    </div>
  );
}

/**
 * One-time acknowledgment that enabling online tiles fetches them from — and so
 * reveals the node viewport to — a third-party host. Shown over the offline
 * basemap until the user accepts or opts to stay offline.
 */
function TileConsent({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='pointer-events-auto absolute inset-x-0 bottom-0 z-1000 flex justify-center p-4'>
      <div className='max-w-md rounded-lg border border-(--border) bg-(--surface) p-4 shadow-lg'>
        <h3 className='mb-1 text-sm font-semibold text-(--text)'>
          {t('map.tileConsentTitle')}
        </h3>
        <p className='mb-3 text-xs text-(--text2)'>
          {t('map.tileConsentBody')}
        </p>
        <div className='flex justify-end gap-2'>
          <button
            onClick={onDecline}
            className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
          >
            {t('map.tileConsentDecline')}
          </button>
          <button
            onClick={onAccept}
            className='rounded-md bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--accent-hover)'
          >
            {t('map.tileConsentAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}
