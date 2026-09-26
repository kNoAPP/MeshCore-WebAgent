// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Maximize } from 'lucide-react';
import L from 'leaflet';
import { useMeshStore } from '@/store/meshStore';
import { useClockTick } from '@/hooks/useClockTick';
import { collectMapNodes, selfMapNode, type MapNode } from '@/lib/map/nodes';
import {
  filterMapNodes,
  filtersActive,
  toggleCategory,
} from '@/lib/map/filters';
import {
  DEFAULT_MAP_PREFS,
  MAP_FOCUS_ZOOM,
  MAP_MARKER_SIZE_PX,
  MAX_MAP_MARKERS,
  type MapPrefs,
  type StartView,
} from '@/lib/map/config';
import { BaseLeafletMap, applyStartView } from './BaseLeafletMap';
import { MapFilterControls } from './MapFilterControls';
import { MapLegend } from './MapLegend';
import { MapNodeList } from './MapNodeList';
import { renderNodePopup } from './MapNodePopup';
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
  // One clock for the whole page. The "heard within" window is measured
  // against the wall clock, so it needs a tick of its own: without one a node
  // would stay plotted after it crossed the selected boundary, until some
  // unrelated store change happened to rebuild the set. Collecting the nodes
  // against the same instant keeps the merged last-heard the filter reads in
  // step with the filter itself.
  const nowSecs = useClockTick();

  const self = useMemo(() => selfMapNode(selfInfo), [selfInfo]);
  const nodes = useMemo(
    () => collectMapNodes(contacts, advertCache, self?.pubkeyPrefix, nowSecs),
    [contacts, advertCache, self?.pubkeyPrefix, nowSecs],
  );

  return <MapPage self={self} nodes={nodes} nowSecs={nowSecs} />;
}

function MapPage({
  self,
  nodes,
  nowSecs,
}: {
  self: MapNode | null;
  nodes: MapNode[];
  nowSecs: number;
}) {
  const { t } = useTranslation();
  const mapPicking = useMeshStore((s) => s.mapPicking);
  // A node the Nodes directory handed over, to frame and open a popup for.
  const mapFocus = useMeshStore((s) => s.mapFocus);

  // What the map is plotting. A per-radio preference, so it survives the
  // session; the node list's collapsed state stays transient UI.
  const filters = useMeshStore((s) => s.mapFilters);
  const setFilters = useMeshStore((s) => s.setMapFilters);

  // The nodes actually eligible for plotting, after the filters. The marker
  // layer, the node list and every piece of framing derive from this, so none
  // of them can disagree — framing a set the map is not plotting would leave
  // the visible markers off screen, or the view empty.
  const visible = useMemo(
    () => filterMapNodes(nodes, filters, nowSecs),
    [nodes, filters, nowSecs],
  );

  // Resolved against the unfiltered set: the operator named this node on
  // another page, so whether the map's own filters would have hidden it says
  // nothing about whether they want to see it. `null` while the handover names
  // a node with no advertised location, or one the advert cache has not
  // hydrated yet — the request then waits rather than being dropped.
  const focusTarget = useMemo(
    () => (mapFocus ? (nodes.find((n) => n.key === mapFocus) ?? null) : null),
    [mapFocus, nodes],
  );
  // A handed-over node the filters exclude is plotted anyway, so it occupies a
  // marker slot the cap notice has to account for — otherwise a filtered node
  // could displace a visible one while the notice still claims nothing was
  // trimmed.
  const focusOutsideVisible = useMemo(
    () =>
      focusTarget !== null && !visible.some((n) => n.key === focusTarget.key),
    [focusTarget, visible],
  );

  const total = visible.length + (focusOutsideVisible ? 1 : 0) + (self ? 1 : 0);
  const capped = total > MAX_MAP_MARKERS;
  // Trimmed to the marker budget, with a slot reserved for this node's own
  // marker. The node list takes the same trimmed set: a row the map is not
  // plotting could be framed but never opened, and its count would disagree
  // with the cap notice. A handed-over node leads the set so it survives both
  // the filters and the cap — framing on a marker the map is not drawing would
  // leave the operator staring at empty tiles.
  const listed = useMemo(() => {
    const budget = MAX_MAP_MARKERS - (self ? 1 : 0);
    if (!focusTarget) return visible.slice(0, budget);
    const rest = visible.filter((n) => n.key !== focusTarget.key);
    return [focusTarget, ...rest.slice(0, Math.max(0, budget - 1))];
  }, [visible, self, focusTarget]);
  // Self first so it survives the cap.
  const plotted = useMemo(
    () => (self ? [self, ...listed] : listed),
    [self, listed],
  );

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
    initialView(useMeshStore.getState().mapPrefs, self, listed),
  );
  // Per-radio preferences and the advert cache both hydrate *after* the session
  // reports 'connected', so a map opened in that window (a `#/map` deep link,
  // or switching straight to Map) frames on whatever the sync happened to have.
  // Two one-shot upgrades of the live map — the first located data, then the
  // radio's own saved viewport. Applied to the existing map rather than by
  // remounting it, so a pin placed while picking survives.
  const savedPrefs = useMeshStore((s) => s.mapPrefs);
  const prefsHydrated = useMeshStore((s) => s.prefsHydrated);
  const framedOnData = useRef(self != null || listed.length > 0);
  const framedOnPrefs = useRef(false);
  // Leaflet reports our own framing through `moveend` as well, so each one is
  // announced here first and consumed by the next move it produces. A move with
  // nothing announced is the user's, and stops both upgrades.
  const framing = useRef(false);
  const userMoved = useRef(false);
  // Previous hydration state, so the reset below fires on the transition
  // rather than for as long as the flag is down.
  const wasHydrated = useRef(prefsHydrated);
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
    // starts over — a move made after this reset still wins. Only the moment
    // the flag drops counts: a pan during the load re-runs this effect (it
    // writes `mapPrefs`), and clearing `userMoved` again there would let the
    // data frame below immediately overwrite the move.
    if (wasHydrated.current && !prefsHydrated) {
      framedOnPrefs.current = false;
      framedOnData.current = false;
      userMoved.current = false;
    }
    wasHydrated.current = prefsHydrated;
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
      // This radio has no saved viewport, so nothing was framed and data is
      // still worth framing on — including nodes that only arrive later, with
      // the advert cache that restores after this. Fall through rather than
      // latching, or the map would sit at the world view with the first
      // located marker off screen.
    }
    if (userMoved.current || framedOnData.current) return;
    if (!self && listed.length === 0) return;
    framedOnData.current = true;
    frame(map, initialView(null, self, listed));
  }, [map, savedPrefs, prefsHydrated, mapPicking, self, listed, frame]);
  // Framing the operator asked for — a list selection, "fit all", "centre on
  // my node". It must not be undone by the late `mapPrefs`/first-data upgrades
  // above, which `userMoved` already blocks, and it is still not a pan, so
  // `frame` keeps it out of the saved viewport.
  const frameDeliberate = useCallback(
    (m: L.Map, view: StartView) => {
      userMoved.current = true;
      frame(m, view);
    },
    [frame],
  );

  // What the map is plotting. A per-radio preference, so it survives the
  // session; the node list's collapsed state stays transient UI.
  const [listOpen, setListOpen] = useState(true);
  // The node list is a sibling of the map, so collapsing it (or hiding it for
  // location picking) changes the map's width. Leaflet caches the container
  // size, and without this the tiles and the hit-testing keep using the old one
  // until something else resizes the window. `invalidateSize` holds the
  // geographic centre and reports the shift through `moveend`, synchronously —
  // announced as ours first, and un-announced again if it turned out to be a
  // no-op, so a later real pan is still persisted.
  useEffect(() => {
    if (!map) return;
    framing.current = true;
    map.invalidateSize();
    framing.current = false;
  }, [map, listOpen, mapPicking]);
  // The node whose popup is open, owned here rather than by the map, so the
  // node list can open one for a node the user never clicked.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // A handover from another page is turned into this component's own popup
  // selection during render, which is what React prescribes for deriving state
  // from a changed input — doing it from an effect would cascade an extra
  // render. Remembering which request was honored keeps a popup the operator
  // then closed from springing back open on the next re-render.
  const [consumedFocus, setConsumedFocus] = useState<string | null>(null);
  if (mapFocus !== null && mapFocus !== consumedFocus) {
    setConsumedFocus(mapFocus);
    setOpenKey(mapFocus);
  }

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

  // Picking a node by name: frame the map on it, then open its popup. Zooming
  // in only when the map is further out keeps a deliberate close-up intact, and
  // the popup opens even while the node is still inside a collapsed cluster.
  const focusNode = useCallback(
    (node: MapNode) => {
      if (map) {
        frameDeliberate(map, {
          center: [node.lat, node.lon],
          zoom: Math.max(map.getZoom(), MAP_FOCUS_ZOOM),
        });
      }
      setOpenKey(node.key);
    },
    [map, frameDeliberate],
  );

  // Framing the handover is Leaflet's business rather than React state, so it
  // belongs in an effect — guarded by the key already framed, because the node
  // set is rebuilt on every clock tick and hands `focusTarget` a new identity
  // long after the request was honored.
  const framedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !focusTarget) return;
    if (framedFocus.current === focusTarget.key) return;
    framedFocus.current = focusTarget.key;
    frameDeliberate(map, {
      center: [focusTarget.lat, focusTarget.lon],
      zoom: Math.max(map.getZoom(), MAP_FOCUS_ZOOM),
    });
  }, [map, focusTarget, frameDeliberate]);

  const fitAll = () => {
    if (!map || plotted.length === 0) return;
    frameDeliberate(map, {
      bounds: plotted.map((n) => [n.lat, n.lon] as [number, number]),
    });
  };

  const centerOnSelf = () => {
    if (!map || !self) return;
    frameDeliberate(map, { center: [self.lat, self.lon], zoom: map.getZoom() });
  };

  return (
    <>
      {!mapPicking && (
        <MapNodeList
          nodes={listed}
          self={self}
          selectedKey={openKey}
          onSelect={focusNode}
          open={listOpen}
          onOpenChange={setListOpen}
        />
      )}
      <BaseLeafletMap
        nodes={plotted}
        startView={startView}
        // Dropped while placing a location pin: a cluster glyph is interactive
        // and would swallow the map click the picker needs, where an individual
        // marker is made inert and lets it through.
        cluster={!mapPicking}
        labels
        renderPopup={mapPicking ? undefined : renderNodePopup}
        openNodeKey={openKey}
        onOpenNodeChange={setOpenKey}
        onMoveEnd={(center, zoom, programmatic) => {
          // `mapPrefs` is null until the *user* moves the map, so our own
          // framing must not persist itself as a saved viewport. The flag is
          // still consumed by a map-made move, which is the same framing
          // carried on by the cluster opening under it.
          const ours = framing.current;
          framing.current = false;
          if (ours || programmatic) return;
          userMoved.current = true;
          useMeshStore.getState().setMapPrefs({ center, zoom });
        }}
        onMapReady={setMap}
      >
        <div className='pointer-events-none absolute inset-x-0 top-0 z-1000 flex items-start justify-end gap-2 p-3'>
          {capped && (
            <span className='pointer-events-auto mr-auto rounded-md border border-border bg-surface/90 px-2.5 py-1 text-xs text-text2 backdrop-blur'>
              {t('map.markerCap', { shown: MAX_MAP_MARKERS, total })}
            </span>
          )}
          {!mapPicking && (
            <div className='pointer-events-auto flex flex-col overflow-hidden rounded-md border border-border bg-surface/90 backdrop-blur'>
              <FrameButton
                onClick={fitAll}
                disabled={plotted.length === 0}
                label={t('map.frame.fitAll')}
                icon={<Maximize size={15} aria-hidden='true' />}
              />
              <FrameButton
                onClick={centerOnSelf}
                disabled={!self}
                label={t('map.frame.centerSelf')}
                icon={<Crosshair size={15} aria-hidden='true' />}
              />
            </div>
          )}
        </div>
        {/* `listed`, not `plotted`: this node's own marker is prepended to
            `plotted` regardless of the filters, so a located self would hide
            the empty state even with no peers left to show. */}
        {listed.length === 0 && !mapPicking && (
          <div className='pointer-events-none absolute inset-0 z-1000 flex items-center justify-center p-6'>
            <p className='pointer-events-auto max-w-sm rounded-card border border-border bg-surface/95 px-4 py-3 text-center text-sm text-text2 backdrop-blur'>
              {t(
                filtersActive(filters)
                  ? 'map.emptyFiltered'
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
        <MapLegend
          categories={{
            active: filters.categories,
            onToggle: (category) =>
              setFilters(toggleCategory(filters, category)),
          }}
        >
          <MapFilterControls filters={filters} onChange={setFilters} />
        </MapLegend>
      </BaseLeafletMap>
    </>
  );
}

function FrameButton({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      title={label}
      className='focus-inset p-1.5 text-text2 not-first:border-t not-first:border-border hover:text-accent disabled:cursor-not-allowed disabled:opacity-40'
    >
      {icon}
      <span className='sr-only'>{label}</span>
    </button>
  );
}
