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
import { collectMapNodes, selfMapNode, type MapNode } from '@/lib/map/nodes';
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
 * before, otherwise a close-in view centered on this node.
 */
function initialView(
  prefs: MapPrefs,
  self: MapNode,
): { center: [number, number]; zoom: number } {
  const untouched =
    prefs.center[0] === DEFAULT_MAP_PREFS.center[0] &&
    prefs.center[1] === DEFAULT_MAP_PREFS.center[1] &&
    prefs.zoom === DEFAULT_MAP_PREFS.zoom;
  if (untouched) return { center: [self.lat, self.lon], zoom: 11 };
  return { center: prefs.center, zoom: prefs.zoom };
}

/** Formats a node's coordinates as `"47.61, -122.33"` (always dot-decimal). */
function formatCoords(node: MapNode): string {
  return `${node.lat.toFixed(4)}, ${node.lon.toFixed(4)}`;
}

/**
 * Desktop map view: plots this node and every located contact/advert. Renders a
 * live slippy map (online, after a one-time tile-host consent) or the bundled
 * offline outline (offline, when forced, or before consent). When this node has
 * no GPS fix, falls back to a coordinate list instead of a map it can't anchor.
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

  if (!self) return <MapFallback nodes={nodes} />;
  return <LeafletMap self={self} nodes={nodes} />;
}

/** The interactive Leaflet map, mounted only when this node has a fix. */
function LeafletMap({ self, nodes }: { self: MapNode; nodes: MapNode[] }) {
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
    initialView(useMeshStore.getState().mapPrefs, self),
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
        L.tileLayer(TILE_URLS[theme], {
          attribution: TILE_ATTRIBUTION,
          subdomains: 'abcd',
          maxZoom: 19,
          detectRetina: true,
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
    for (const node of [self, ...nodes].slice(0, MAX_MAP_MARKERS)) {
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

  const total = nodes.length + 1;
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

/**
 * Shown when this node has no GPS fix, so an anchored map isn't meaningful.
 * Lists located contacts/adverts with their coordinates; contact rows open the
 * manage panel. This path is offline by construction (no tiles).
 */
function MapFallback({ nodes }: { nodes: MapNode[] }) {
  const { t } = useTranslation();
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  return (
    <div className='flex-1 overflow-y-auto p-6'>
      <div className='mx-auto max-w-lg'>
        <h2 className='mb-1 text-base font-bold text-(--text)'>
          {t('map.fallbackTitle')}
        </h2>
        <p className='mb-4 text-sm text-(--text2)'>{t('map.fallbackBody')}</p>
        {sorted.length === 0 ? (
          <p className='text-sm text-(--text2)'>{t('map.fallbackEmpty')}</p>
        ) : (
          <ul className='divide-y divide-(--border) rounded-lg border border-(--border)'>
            {sorted.map((node) => {
              const isContact = node.kind === 'contact';
              return (
                <li key={node.key}>
                  <button
                    disabled={!isContact}
                    onClick={() =>
                      setManagePanel({ kind: 'contact', id: node.pubkeyPrefix })
                    }
                    className='flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-(--surface2) disabled:cursor-default'
                  >
                    <span className='text-lg'>
                      {ADV_ICON[node.advType] ?? '👤'}
                    </span>
                    <span className='min-w-0 flex-1 truncate text-sm text-(--text)'>
                      {node.name}
                    </span>
                    <span className='shrink-0 font-mono text-xs text-(--text2)'>
                      {formatCoords(node)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
