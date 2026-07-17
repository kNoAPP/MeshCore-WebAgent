// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { useMeshStore } from '@/store/meshStore';
import { collectMapNodes, selfMapNode, type MapNode } from '@/lib/map/nodes';
import {
  DEFAULT_MAP_PREFS,
  MAP_MARKER_SIZE_PX,
  MAX_MAP_MARKERS,
  type MapPrefs,
  type StartView,
} from '@/lib/map/config';
import { BaseLeafletMap } from './BaseLeafletMap';
import { MapLegend } from './MapLegend';

/**
 * A draggable pin used only in location-pick mode: a filled accent circle with
 * a white ring, distinct from the category node markers.
 */
function pickIcon(): L.DivIcon {
  const size = MAP_MARKER_SIZE_PX;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:var(--accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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
  const advertCache = useMeshStore((s) => s.advertCache);

  const self = useMemo(() => selfMapNode(selfInfo), [selfInfo]);
  const nodes = useMemo(
    () => collectMapNodes(contacts, advertCache, self?.pubkeyPrefix),
    [contacts, advertCache, self?.pubkeyPrefix],
  );

  return <MapPage self={self} nodes={nodes} />;
}

/**
 * The Map page: composes {@link BaseLeafletMap} with the page-specific
 * concerns — viewport persistence, the favorites-only filter, the marker cap,
 * location-pick mode, and the legend. This node's marker shows when located.
 */
function MapPage({ self, nodes }: { self: MapNode | null; nodes: MapNode[] }) {
  const { t } = useTranslation();
  const mapPicking = useMeshStore((s) => s.mapPicking);

  // The Leaflet map, once created — needed to wire location-pick mode against
  // it. Held in state so the pick effect re-runs when the map (re)mounts.
  const [map, setMap] = useState<L.Map | null>(null);
  const pickMarkerRef = useRef<L.Marker | null>(null);
  // Latest self, read imperatively when entering pick mode. Keeping it out of
  // the pick effect's deps means a mid-pick reconnect (which hands us a new
  // `self`) won't re-run the effect and discard the user's placed pin.
  const selfRef = useRef(self);
  useEffect(() => {
    selfRef.current = self;
  }, [self]);
  // The coordinate (decimal degrees) the user has placed, or null until the
  // first map click while picking. Drives the Confirm button's enabled state.
  const [pickedPoint, setPickedPoint] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
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

  const total = visible.length + (self ? 1 : 0);
  const capped = total > MAX_MAP_MARKERS;
  // Self first so it survives the cap, then the visible set, trimmed to the
  // DOM-node budget the base map plots.
  const plotted = useMemo(
    () => (self ? [self, ...visible] : visible).slice(0, MAX_MAP_MARKERS),
    [self, visible],
  );

  // Location-pick mode: place/move a draggable pin on map clicks and pre-seed
  // it at this node's advertised location (if any). Wired only while picking so
  // normal map clicks stay inert otherwise.
  useEffect(() => {
    if (!map || !mapPicking) return;

    const place = (lat: number, lon: number) => {
      // Round to ~0.1 m so the value sent matches what the inputs display.
      const rLat = Math.round(lat * 1e6) / 1e6;
      const rLon = Math.round(lon * 1e6) / 1e6;
      setPickedPoint({ lat: rLat, lon: rLon });
      if (pickMarkerRef.current) {
        pickMarkerRef.current.setLatLng([rLat, rLon]);
      } else {
        const marker = L.marker([rLat, rLon], {
          icon: pickIcon(),
          draggable: true,
          zIndexOffset: 1000,
        }).addTo(map);
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          place(p.lat, p.lng);
        });
        pickMarkerRef.current = marker;
      }
    };

    const seed = selfRef.current;
    if (seed) place(seed.lat, seed.lon);

    const onClick = (e: L.LeafletMouseEvent) =>
      place(e.latlng.lat, e.latlng.lng);
    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      setPickedPoint(null);
    };
  }, [map, mapPicking]);

  return (
    <BaseLeafletMap
      nodes={plotted}
      startView={startView}
      onNodeClick={
        mapPicking
          ? undefined
          : (node) => {
              // Self is never clickable; the base map only invokes this for
              // contact/advert markers.
              if (node.kind === 'self') return;
              useMeshStore
                .getState()
                .setManagePanel({ kind: node.kind, id: node.pubkeyPrefix });
            }
      }
      onMoveEnd={(center, zoom) =>
        useMeshStore.getState().setMapPrefs({ center, zoom })
      }
      onMapReady={setMap}
    >
      <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-col items-start gap-2 p-3'>
        {capped && (
          <span className='pointer-events-auto rounded-md border border-(--border) bg-(--surface)/90 px-2.5 py-1 text-xs text-(--text2) backdrop-blur'>
            {t('map.markerCap', { shown: MAX_MAP_MARKERS, total })}
          </span>
        )}
      </div>
      {mapPicking && (
        <div className='pointer-events-none absolute inset-x-0 bottom-6 z-1000 flex justify-center px-3'>
          <div className='pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-md border border-(--border) bg-(--surface)/95 px-3 py-2 text-sm text-(--text) backdrop-blur'>
            <span className='text-(--text2)'>{t('map.pick.hint')}</span>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => useMeshStore.getState().cancelLocationPick()}
                className='rounded-md border border-(--border) px-3 py-1 text-xs font-medium text-(--text2) hover:text-(--text)'
              >
                {t('map.pick.cancel')}
              </button>
              <button
                type='button'
                disabled={!pickedPoint}
                onClick={() => {
                  if (pickedPoint) {
                    useMeshStore
                      .getState()
                      .confirmLocationPick(pickedPoint.lat, pickedPoint.lon);
                  }
                }}
                className='rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-white disabled:opacity-50'
              >
                {t('map.pick.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <MapLegend>
        <button
          type='button'
          role='switch'
          aria-checked={favoritesOnly}
          onClick={() => setFavoritesOnly((v) => !v)}
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
      </MapLegend>
    </BaseLeafletMap>
  );
}
