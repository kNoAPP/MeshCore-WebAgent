// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import {
  useMeshStore,
  openConvo,
  directConvoId,
  repeaterConvoId,
} from '@/store/meshStore';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import { collectMapNodes, selfMapNode, type MapNode } from '@/lib/map/nodes';
import {
  DEFAULT_MAP_PREFS,
  MAP_MARKER_SIZE_PX,
  MAX_MAP_MARKERS,
  type MapPrefs,
  type StartView,
} from '@/lib/map/config';
import {
  BaseLeafletMap,
  applyStartView,
  type NodeAction,
} from './BaseLeafletMap';
import { MapLegend } from './MapLegend';
import { Switch } from './Switch';

function pickIcon(): L.DivIcon {
  const size = MAP_MARKER_SIZE_PX;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:var(--accent);border:3px solid var(--map-outline);box-shadow:0 1px 4px var(--map-shadow)"></div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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

/** A map's current centre and zoom, for comparing one framing to another. */
function viewOf(map: L.Map): [number, number, number] {
  const c = map.getCenter();
  return [c.lat, c.lng, map.getZoom()];
}

function sameView(a: [number, number, number], b: [number, number, number]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
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
  // Per-radio preferences and the advert cache both hydrate *after* the session
  // reports 'connected', so a map opened in that window (a `#/map` deep link,
  // or switching straight to Map) frames on whatever the sync happened to have.
  // Two one-shot upgrades of the live map — the first located data, then the
  // radio's own saved viewport. Applied to the existing map rather than by
  // remounting it, so a pin placed while picking survives.
  const savedPrefs = useMeshStore((s) => s.mapPrefs);
  const prefsHydrated = useMeshStore((s) => s.prefsHydrated);
  const framedOnData = useRef(self != null || nodes.length > 0);
  const framedOnPrefs = useRef(false);
  // Leaflet reports our own framing through `moveend` as well, so each one is
  // announced here first and consumed by the next move it produces. A move with
  // nothing announced is the user's, and stops both upgrades.
  const framing = useRef(false);
  const userMoved = useRef(false);
  const frame = useCallback((m: L.Map, view: StartView) => {
    const before = viewOf(m);
    framing.current = true;
    applyStartView(m, view);
    // Already there: no move follows, so nothing would consume the flag.
    if (sameView(before, viewOf(m))) framing.current = false;
  }, []);
  useEffect(() => {
    if (!map || mapPicking) return;
    // A reconnect clears the flag and re-runs the hydrate. That may even be a
    // different radio on a shared endpoint, so every piece of framing intent
    // starts over — a move made after this reset still wins.
    if (!prefsHydrated) {
      framedOnPrefs.current = false;
      framedOnData.current = false;
      userMoved.current = false;
    }
    if (prefsHydrated && !framedOnPrefs.current) {
      framedOnPrefs.current = true;
      if (userMoved.current) {
        // Their pan is already the saved viewport — `restorePreferences` keeps
        // a `mapPrefs` set while the blob was loading — so there is nothing
        // left to upgrade to, and reframing would undo the move.
        framedOnData.current = true;
        return;
      }
      if (savedPrefs) {
        framedOnData.current = true;
        frame(map, { center: savedPrefs.center, zoom: savedPrefs.zoom });
        return;
      }
      // This radio has no saved viewport, so data is still worth framing on.
    }
    if (userMoved.current || framedOnData.current) return;
    if (!self && nodes.length === 0) return;
    framedOnData.current = true;
    frame(map, initialView(null, self, nodes));
  }, [map, savedPrefs, prefsHydrated, mapPicking, self, nodes, frame]);
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

  // Popup actions per node. Only a real contact can be messaged — an advert is
  // a node the radio has heard but doesn't hold in its contact table — so that
  // action is offered conditionally rather than shown as a dead button.
  const nodeActions = useCallback(
    (node: MapNode): NodeAction[] => {
      const actions: NodeAction[] = [];
      if (node.kind === 'contact') {
        // A repeater or room server opens its admin view, not a chat, so the
        // action says so rather than promising a conversation.
        const isAdminNode =
          node.advType === ADV_TYPE_REPEATER || node.advType === ADV_TYPE_ROOM;
        actions.push({
          key: 'open',
          label: t(isAdminNode ? 'map.popup.administer' : 'map.popup.message'),
          onSelect: (n) => {
            openConvo({
              kind: isAdminNode ? 'repeater' : 'direct',
              id: isAdminNode
                ? repeaterConvoId(n.pubkeyPrefix)
                : directConvoId(n.pubkeyPrefix),
              rawId: n.pubkeyPrefix,
              label: n.name,
            });
            useMeshStore.getState().setView('chat');
          },
        });
      }
      actions.push({
        key: 'manage',
        label: t('map.popup.manage'),
        onSelect: (n) => {
          // The base map never offers actions on the self marker.
          if (n.kind === 'self') return;
          useMeshStore
            .getState()
            .setManagePanel({ kind: n.kind, id: n.pubkeyPrefix });
        },
      });
      return actions;
    },
    [t],
  );

  return (
    <BaseLeafletMap
      nodes={plotted}
      startView={startView}
      nodeActions={mapPicking ? undefined : nodeActions}
      onMoveEnd={(center, zoom) => {
        // `mapPrefs` is null until the *user* moves the map, so our own
        // framing must not persist itself as a saved viewport.
        if (framing.current) {
          framing.current = false;
          return;
        }
        userMoved.current = true;
        useMeshStore.getState().setMapPrefs({ center, zoom });
      }}
      onMapReady={setMap}
    >
      <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-col items-start gap-2 p-3'>
        {capped && (
          <span className='pointer-events-auto rounded-md border border-border bg-surface/90 px-2.5 py-1 text-xs text-text2 backdrop-blur'>
            {t('map.markerCap', { shown: MAX_MAP_MARKERS, total })}
          </span>
        )}
      </div>
      {/* `visible`, not `plotted`: this node's own marker is prepended to
          `plotted` regardless of the filter, so a located self would hide the
          empty state even with no peers left to show. */}
      {visible.length === 0 && !mapPicking && (
        <div className='pointer-events-none absolute inset-0 z-1000 flex items-center justify-center p-6'>
          <p className='max-w-sm rounded-card border border-border bg-surface/95 px-4 py-3 text-center text-sm text-text2 backdrop-blur'>
            {t(
              favoritesOnly
                ? 'map.emptyFavorites'
                : self
                  ? 'map.emptyPeers'
                  : 'map.empty',
            )}
          </p>
        </div>
      )}
      {mapPicking && (
        <div className='pointer-events-none absolute inset-x-0 bottom-6 z-1000 flex justify-center px-3'>
          <div className='pointer-events-auto flex flex-wrap items-center justify-center gap-3 rounded-md border border-border bg-surface/95 px-3 py-2 text-sm text-text backdrop-blur'>
            <span className='text-text2'>{t('map.pick.hint')}</span>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => useMeshStore.getState().cancelLocationPick()}
                className='rounded-md border border-border px-3 py-1 text-xs font-medium text-text2 hover:text-text'
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
                className='rounded-md bg-accent-solid px-3 py-1 text-xs font-medium text-white disabled:opacity-50'
              >
                {t('map.pick.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <MapLegend>
        <Switch
          checked={favoritesOnly}
          onChange={setFavoritesOnly}
          label={t('map.legend.favoritesOnly')}
          className='focus-inset border-t border-border px-2.5 py-2 whitespace-nowrap hover:text-accent'
        />
      </MapLegend>
    </BaseLeafletMap>
  );
}
