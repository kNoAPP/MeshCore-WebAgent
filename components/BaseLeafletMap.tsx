// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useMeshStore } from '@/store/meshStore';
import {
  clusterIcon,
  escapeHtml,
  nodeIcon,
  type NodeMarker,
} from '@/lib/map/leafletIcon';
import {
  placeEdgeLabel,
  pointAlongEdge,
  type LabelBox,
} from '@/lib/map/edgeLabel';
import type { MapEdge, MapNode } from '@/lib/map/nodes';
import {
  MAP_CLUSTER_RADIUS_PX,
  MAP_EDGE_OPACITY,
  MAP_EDGE_WEIGHT,
  MAP_LABEL_MIN_ZOOM,
  MAP_MARKER_SIZE_PX,
  MAP_MAX_ZOOM,
  MAP_POPUP_MAX_WIDTH_PX,
  TILE_ATTRIBUTION,
  TILE_URLS,
  type StartView,
} from '@/lib/map/config';

// Latitude is clamped to the Web Mercator limit (±85.05113°), so the bounds
// line up with the tile grid's top and bottom edges — no blank strip.
const WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85.05112878, -180],
  [85.05112878, 180],
];

// Leaflet names a pane's element `leaflet-<name>-pane`, which is what
// `app/globals.css` stacks the popups with.
const POPUP_PANE = 'meshcore-popup';

// The deepest zoom that still has tiles to draw. `detectRetina` costs the tile
// layer one level on a hi-DPI display — Leaflet halves the tile size and
// decrements the layer's own `maxZoom` — so a map ceiling of `MAP_MAX_ZOOM`
// would let the user zoom one step past the last level `GridLayer` will render,
// onto a blank basemap.
function maxTileZoom(): number {
  return L.Browser.retina ? MAP_MAX_ZOOM - 1 : MAP_MAX_ZOOM;
}

/**
 * Props for {@link BaseLeafletMap}. The component owns only the reusable map
 * machinery — tile basemap, world bounds, min-zoom clamp, theme swap, and the
 * marker/edge layers — and takes the plotted node/edge set from the caller.
 * Page-specific concerns (location picking, viewport persistence, favorites,
 * marker caps, the legend) belong in the composing wrapper.
 */
export interface BaseLeafletMapProps {
  /** Nodes to plot; a `kind: 'self'` node is ringed and labeled "This node". */
  nodes: MapNode[];
  /** Optional links between located nodes (e.g. a repeater→neighbor SNR). */
  edges?: MapEdge[];
  /** The opening viewport, captured once by the caller (a stable value). */
  startView: StartView;
  /**
   * Invoked when a non-self node's marker is clicked. When omitted, markers are
   * inert (the Map page passes `undefined` while in location-pick mode).
   */
  onNodeClick?: (node: MapNode) => void;
  /**
   * Renders the body of a popup anchored to the clicked marker. When supplied
   * it *replaces* {@link onNodeClick} as the click behavior — markers stay
   * interactive, but the click opens the popup instead. `close` dismisses it,
   * for an action that navigates away from the map.
   */
  renderPopup?: (node: MapNode, close: () => void) => ReactNode;
  /**
   * Key of the node whose popup is open, taking the popup out of the map's own
   * hands so a caller can open one from outside it (a node list, a search
   * result). Supply it together with {@link onOpenNodeChange}; omit both and
   * the map tracks the open popup itself.
   */
  openNodeKey?: string | null;
  /** Reports every open/close while the popup is controlled. */
  onOpenNodeChange?: (key: string | null) => void;
  /**
   * Collapse overlapping markers into count glyphs that expand on click.
   * Toggling it rebuilds the marker layer only — the map, its viewport and any
   * open popup survive — so a caller may turn it off for a mode in which an
   * interactive cluster glyph would be in the way.
   */
  cluster?: boolean;
  /**
   * Draw each node's name beside its marker, from
   * {@link MAP_LABEL_MIN_ZOOM} up (favorites at every zoom).
   */
  labels?: boolean;
  /** Invoked after each pan/zoom, for callers that persist the viewport. */
  onMoveEnd?: (center: [number, number], zoom: number) => void;
  /**
   * Receives the Leaflet map on creation and `null` on teardown, so a wrapper
   * can wire imperative behavior (e.g. click-to-place picking) against it.
   */
  onMapReady?: (map: L.Map | null) => void;
  /** Overlays rendered above the map (banners, legend, cap notice). */
  children?: ReactNode;
}

/**
 * Frames {@link map} on {@link view}. The `bounds` case fits every located
 * node; `maxZoom` keeps a single node (or a tight cluster) from slamming all
 * the way to street level. Never animated: callers rely on the move landing
 * before this returns, so they can tell their own framing from a user pan.
 */
export function applyStartView(map: L.Map, view: StartView): void {
  if ('bounds' in view) {
    map.fitBounds(view.bounds, {
      padding: [40, 40],
      maxZoom: 13,
      animate: false,
    });
  } else {
    map.setView(view.center, view.zoom, { animate: false });
  }
}

/**
 * The reusable interactive Leaflet map: an online raster basemap (CARTO
 * Positron/Dark Matter, matching the app theme) inside a single locked world,
 * plotting the caller's nodes and edges. Composed by the Map page and the
 * Neighbors map; it holds no page-specific state of its own.
 */
export function BaseLeafletMap({
  nodes,
  edges,
  startView,
  onNodeClick,
  renderPopup,
  openNodeKey,
  onOpenNodeChange,
  cluster = false,
  labels = false,
  onMoveEnd,
  onMapReady,
  children,
}: BaseLeafletMapProps) {
  const { t } = useTranslation();
  const theme = useMeshStore((s) => s.theme);
  // Edge labels are decluttered in pixel space, which only holds at the zoom
  // they were placed at, so a zoom change has to re-run that pass.
  const [zoom, setZoom] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  // The same layer as `markerLayerRef` when clustering is on, kept separately
  // so the bulk `addLayers` path (which the plugin batches) is typed.
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const edgeLayerRef = useRef<L.LayerGroup | null>(null);
  // Signatures of the currently plotted markers/edges; let the rebuild effects
  // skip work when nothing changed. Reset whenever a layer is (re)created so a
  // fresh, empty layer is always repopulated (e.g. StrictMode's remount).
  const markerSigRef = useRef<string>('');
  const edgeSigRef = useRef<string>('');
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Held in refs so their identity churn never re-runs the create effect (which
  // would tear down and rebuild the whole map). `clickable` still feeds the
  // marker signature so wiring toggles when a handler is added/removed.
  const onNodeClickRef = useRef(onNodeClick);
  const renderPopupRef = useRef(renderPopup);
  const onMoveEndRef = useRef(onMoveEnd);
  const onMapReadyRef = useRef(onMapReady);
  // The plotted markers by node key, so the open popup can find the live
  // marker for a node after a rebuild has replaced the element it came from.
  const markersRef = useRef(new Map<string, L.Marker>());
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    renderPopupRef.current = renderPopup;
    onMoveEndRef.current = onMoveEnd;
    onMapReadyRef.current = onMapReady;
  });

  // The key of the node whose popup is open, or null. Keyed rather than held
  // as a snapshot so the body always renders the node as it stands now: a
  // fresh advert can move it, and a node dropped from the plotted set takes
  // its popup with it. The body itself is React, portalled into this detached
  // host that Leaflet adopts as the popup's content — so it keeps the app's
  // store, theme and i18n instead of being assembled as an HTML string.
  // A caller that supplies `onOpenNodeChange` owns the key instead, which is
  // what lets the node list open a popup the map never got a click for.
  const [uncontrolledKey, setUncontrolledKey] = useState<string | null>(null);
  const controlled = onOpenNodeChange != null;
  const popupKey = controlled ? (openNodeKey ?? null) : uncontrolledKey;
  const setPopupKey = useCallback(
    (key: string | null) => {
      if (onOpenNodeChange) onOpenNodeChange(key);
      else setUncontrolledKey(key);
    },
    [onOpenNodeChange],
  );
  // The create effect wires Leaflet's own close/click handlers once, for the
  // life of the map, so it reaches the current setter through a ref rather than
  // taking one whose identity follows a prop.
  const setPopupKeyRef = useRef(setPopupKey);
  useEffect(() => {
    setPopupKeyRef.current = setPopupKey;
  });
  const popupHost = useState(() => document.createElement('div'))[0];
  const popupNode =
    popupKey == null ? null : (nodes.find((n) => n.key === popupKey) ?? null);
  // Read by the open effect below without being a dependency of it: a fresh
  // advert changes this object constantly and must *move* the open popup (the
  // last effect in this file), never reopen it. Declared before that effect,
  // so it is already current when the effect runs in the same commit.
  const popupNodeRef = useRef(popupNode);
  useEffect(() => {
    popupNodeRef.current = popupNode;
  });
  // The popup this component opened, and the node it belongs to. Leaflet
  // reports the *old* popup closing while a new one opens, so the close
  // handler has to tell them apart or switching markers would dismiss the
  // popup that was just opened.
  const popupRef = useRef<L.Popup | null>(null);
  const popupKeyRef = useRef<string | null>(null);
  // Where the popup opens: the clicked marker's position, captured by the
  // click itself so the anchor never depends on a later lookup. Tagged with
  // the node it was captured for, because a popup opened from outside the map
  // has no click of its own and must not inherit the last one's anchor.
  const popupAnchorRef = useRef<{ key: string; at: L.LatLng } | null>(null);
  // Whatever held focus when the popup opened. A node picked from the node list
  // can still be inside a collapsed cluster, and a clustered marker has no
  // element to hand focus back to, so the opener is the fallback target.
  const popupOpenerRef = useRef<HTMLElement | null>(null);
  // Whether focus has been inside the open popup. React unmounts the body as
  // soon as the node leaves the plotted set — an age tick, a filter, a cache
  // eviction — which drops focus to `document.body` *before* Leaflet reports
  // the close, so by then there is nothing left to read it off the DOM.
  const popupHadFocusRef = useRef(false);
  const closePopup = useCallback(() => setPopupKey(null), [setPopupKey]);
  // Only when focus is still inside the popup being closed: a close that came
  // from clicking the map (or from opening another marker's popup) has already
  // put focus where the user meant it to go. The marker is looked up live,
  // because a rebuild between opening and closing replaces its element; when it
  // has no element at all — clustered away, or filtered out — focus goes back
  // to whatever opened the popup instead of falling to the document.
  const restorePopupFocus = useCallback(() => {
    const active = document.activeElement;
    const inside =
      active instanceof HTMLElement && active.closest('.leaflet-popup') != null;
    // Either focus is still in the popup, or it was and the body has already
    // been unmounted out from under it. Anything else — a map click, another
    // marker's popup — has already put focus where the user meant it to go.
    const orphaned =
      popupHadFocusRef.current && (active == null || active === document.body);
    popupHadFocusRef.current = false;
    if (!inside && !orphaned) return;
    const key = popupKeyRef.current;
    const marker =
      key == null ? null : markersRef.current.get(key)?.getElement();
    // The map container last: a filter that removes the node closes its popup
    // and can unmount the row that opened it in the same commit, and landing on
    // `document.body` would strand the keyboard outside the map entirely.
    const target =
      marker?.isConnected === true
        ? marker
        : popupOpenerRef.current?.isConnected === true
          ? popupOpenerRef.current
          : (mapRef.current?.getContainer() ?? null);
    if (target?.isConnected) target.focus();
  }, []);

  // Create the map once per opening viewport.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      // Lock to a single world so markers (which Leaflet renders only on the
      // primary copy) can't disagree with a basemap repeated at low zoom. The
      // opening viewport is applied below, once the min zoom is known.
      maxBounds: WORLD_BOUNDS,
      maxBoundsViscosity: 1,
      // Stated on the map rather than inherited from the tile layer: the
      // cluster group reads `getMaxZoom()` when it is added, and refuses to
      // attach to a map whose ceiling is still unbounded.
      maxZoom: maxTileZoom(),
    });
    mapRef.current = map;

    // Popups get their own pane, attached to the map *container* instead of
    // the default one inside `.leaflet-map-pane`. That pane carries both a
    // transform and a `z-index`, so it is a stacking context of its own and
    // nothing inside it can outrank the overlays the page stacks over the map
    // (the legend, the marker-cap banner) — a popup near one of them would be
    // painted underneath. Out here the pane's own `z-index` counts, and
    // mirroring the map pane's transform keeps the popup tracking a drag.
    const popupPane = map.createPane(POPUP_PANE, map.getContainer());
    const mapPane = map.getPane('mapPane');
    const syncPopupPane = () => {
      if (mapPane) popupPane.style.transform = mapPane.style.transform;
    };
    syncPopupPane();
    map.on('move zoom viewreset zoomanim', syncPopupPane);

    // Never let the viewport show blank space around the world: the minimum
    // zoom is the smallest level at which the world still covers the whole
    // container, recomputed whenever the container resizes.
    const clampMinZoom = () => {
      map.setMinZoom(map.getBoundsZoom(WORLD_BOUNDS, true));
    };
    clampMinZoom();
    map.on('resize', clampMinZoom);

    // Apply the opening viewport now, before the persist handler is wired, so
    // this programmatic move never reports a move for a user who hasn't panned.
    applyStartView(map, startView);

    // Edges sit under markers so a node's shape always reads on top of its
    // links. The marker layer is created by its own effect below, so that
    // clustering can be switched without tearing down the map.
    edgeLayerRef.current = L.layerGroup().addTo(map);
    // Brand-new, empty layers: force the next rebuilds rather than
    // short-circuit on a signature left over from the previous layers.
    markerSigRef.current = '';
    edgeSigRef.current = '';

    // `noWrap` keeps the basemap to one world (matching the bounded view);
    // `detectRetina` swaps in `@2x` tiles (via the `{r}` token) on hi-DPI
    // displays so labels stay crisp under the app's 1.25 CSS zoom.
    tileLayerRef.current = L.tileLayer(
      TILE_URLS[useMeshStore.getState().theme],
      {
        attribution: TILE_ATTRIBUTION,
        subdomains: 'abcd',
        maxZoom: MAP_MAX_ZOOM,
        noWrap: true,
        detectRetina: true,
      },
    ).addTo(map);

    // Leaflet fires this only when a popup actually had to shift the map to
    // fit on screen, so the move that follows is ours. Swallowing it keeps a
    // caller that persists the viewport from recording a marker click as a pan.
    let autoPanned = false;
    const onAutoPan = () => {
      autoPanned = true;
    };
    map.on('autopanstart', onAutoPan);

    const onMove = () => {
      if (autoPanned) {
        autoPanned = false;
        return;
      }
      const c = map.getCenter();
      onMoveEndRef.current?.([c.lat, c.lng], map.getZoom());
    };
    map.on('moveend', onMove);

    const onZoom = () => setZoom(map.getZoom());
    onZoom();
    map.on('zoomend', onZoom);

    // Fires before Leaflet detaches the popup, so focus can still be read out
    // of it. A popup being replaced by the next one is not ours any more, and
    // clearing the state for it would close the popup just opened.
    const onPopupClose = (e: L.PopupEvent) => {
      if (e.popup !== popupRef.current) return;
      popupRef.current = null;
      restorePopupFocus();
      popupKeyRef.current = null;
      setPopupKeyRef.current(null);
    };
    map.on('popupclose', onPopupClose);

    // Dismissing on a map click is ours rather than Leaflet's `closeOnClick`:
    // that one runs off a synthetic `preclick` which bubbles even from a
    // marker whose events do not, so re-clicking the open marker would close
    // the popup and then re-select the node it is already showing — leaving
    // the state pointing at a popup that is no longer on screen. A click that
    // reaches the map is, by definition, not on a marker.
    const onMapClick = () => setPopupKeyRef.current(null);
    map.on('click', onMapClick);

    onMapReadyRef.current?.(map);

    return () => {
      onMapReadyRef.current?.(null);
      map.off('moveend', onMove);
      map.off('move zoom viewreset zoomanim', syncPopupPane);
      map.off('autopanstart', onAutoPan);
      map.off('zoomend', onZoom);
      map.off('popupclose', onPopupClose);
      map.off('click', onMapClick);
      map.off('resize', clampMinZoom);
      map.remove();
      mapRef.current = null;
      edgeLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, [startView, restorePopupFocus]);

  // The marker layer, owned separately from the map so clustering can be turned
  // off and on — the Map page drops it while placing a location pin, because a
  // cluster glyph is interactive and would swallow the click meant for the
  // map — without tearing down the viewport or an open popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    // Clustering keeps a dense mesh legible and bounds the DOM: only the
    // visible clusters and their expanded children are rendered. Coverage
    // polygons are off — they outline the cluster's bounding hull, which on a
    // regional mesh sweeps across half the viewport on every hover.
    const layer = cluster
      ? L.markerClusterGroup({
          maxClusterRadius: MAP_CLUSTER_RADIUS_PX,
          showCoverageOnHover: false,
          iconCreateFunction: clusterIcon,
          // Not chunked: `addLayers` would spread the batch over `setTimeout`
          // continuations that `clearLayers()` does not cancel, so a rebuild
          // landing mid-batch (a filter change, the label threshold, a fresh
          // advert) would let the previous generation insert stale markers into
          // the layer that was just emptied. `MAX_MAP_MARKERS` keeps the
          // synchronous pass bounded.
          chunkedLoading: false,
        })
      : L.layerGroup();
    clusterGroupRef.current = cluster ? (layer as L.MarkerClusterGroup) : null;
    markerLayerRef.current = layer;
    // Brand-new and empty: force the rebuild below rather than let it
    // short-circuit on the signature left over from the previous layer.
    markerSigRef.current = '';
    layer.addTo(map);
    return () => {
      layer.remove();
      markerLayerRef.current = null;
      clusterGroupRef.current = null;
      markers.clear();
    };
  }, [cluster, startView]);

  // Point the single tile layer at the active theme's CARTO style; light/dark
  // just swaps the URL template, avoiding a remove/re-add flash.
  useEffect(() => {
    tileLayerRef.current?.setUrl(TILE_URLS[theme]);
  }, [theme]);

  // Rebuild markers when the plotted node set changes. The advert cache can
  // hold thousands of nodes and refresh several times a second on a busy mesh,
  // so skip the DOM rebuild when nothing actually plotted changed — a refresh
  // that only bumps `lastHeard`, or touches an off-map node, moves no marker
  // and must not churn the layer.
  const clickable = onNodeClick != null || renderPopup != null;
  // Which markers carry their name. A marker is only ever in the DOM when it is
  // drawn on its own, so with clustering on there is always room for a label:
  // anything closer than `MAP_CLUSTER_RADIUS_PX` to another node has collapsed
  // into a count glyph instead. Without clustering nothing separates them, so
  // the zoom threshold stands in for that and only favorites are named below
  // it. A mode rather than the raw zoom, so the rebuild happens on the crossing
  // and not on every wheel notch.
  const labelMode = !labels
    ? 'none'
    : cluster || zoom >= MAP_LABEL_MIN_ZOOM
      ? 'all'
      : 'favorites';
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    const sig = nodes
      .map(
        (n) =>
          `${n.kind}:${n.key}:${n.lat}:${n.lon}:${n.advType}:${n.favorite ? 1 : 0}:${n.positionUnknown ? 'u' : ''}:${n.name}`,
      )
      .join('|');
    // `t` (locale) drives the self tooltip and `clickable` gates click wiring,
    // so both belong in the signature that decides whether a rebuild is needed,
    // as does the label mode the zoom has settled on.
    const fullSig = `${clickable ? 'click' : ''}|${labelMode}|${t('map.self')}|${sig}`;
    if (fullSig === markerSigRef.current) return;
    markerSigRef.current = fullSig;

    layer.clearLayers();
    markersRef.current.clear();
    const markers: L.Marker[] = [];
    for (const node of nodes) {
      // A node parked on the unplaced ring sits at an invented coordinate and
      // is known only by its prefix, so there is nothing for a click to open.
      const inert = !(
        clickable &&
        node.kind !== 'self' &&
        !node.positionUnknown
      );
      const name = node.kind === 'self' ? t('map.self') : node.name;
      const labeled =
        labelMode === 'all' || (labelMode === 'favorites' && node.favorite);
      const marker = L.marker([node.lat, node.lon], {
        icon: nodeIcon(node, labeled ? name : undefined),
        // An inert marker (location-pick mode, or the self node) would
        // otherwise swallow the click the map needs to place the pin, and
        // would be a dead stop for the keyboard.
        bubblingMouseEvents: inert,
        keyboard: !inert,
        // Leaflet puts this on the container, which is what names the button
        // it makes of an interactive marker.
        title: inert ? undefined : name,
      }) as NodeMarker;
      // Read back by the cluster glyph, which colors itself after its
      // children when they all share a category.
      marker.meshNode = node;
      marker.bindTooltip(escapeHtml(name), { direction: 'top' });
      if (!inert) {
        marker.on('click', () => {
          if (!renderPopupRef.current) {
            onNodeClickRef.current?.(node);
            return;
          }
          // The marker's own position, so the popup always has an anchor even
          // if this node leaves the plotted set in the same batch as the
          // click. The effect below takes over keeping it current.
          popupAnchorRef.current = { key: node.key, at: marker.getLatLng() };
          setPopupKey(node.key);
        });
      }
      markers.push(marker);
      markersRef.current.set(node.key, marker);
    }
    // The cluster group indexes a whole batch in one pass; a plain group has no
    // such path, so it takes them singly.
    const group = clusterGroupRef.current;
    if (group) group.addLayers(markers);
    else for (const marker of markers) marker.addTo(layer);
    // `startView` recreates the map with empty layers, and `cluster` swaps the
    // marker layer for an empty one of the other kind, so both have to refill.
  }, [nodes, t, clickable, labelMode, cluster, startView, setPopupKey]);

  // Open the popup for the selected node, anchored at its coordinates. It is
  // added to the map rather than bound to the marker, so a marker rebuild —
  // which a busy advert cache triggers constantly — cannot close it mid-read,
  // and a node still inside a collapsed cluster is just as openable as one
  // whose marker is on screen. Keyed on the node alone: the anchor is kept
  // current by the effect below, so a live update moves the popup instead of
  // reopening it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // The click's own anchor when this is the node that was clicked; otherwise
    // the node's current position, which is all a selection made off-map has.
    // One-shot: left in place it would still match this key the next time the
    // node is opened from the list, and auto-pan to where it used to be.
    const clicked = popupAnchorRef.current;
    popupAnchorRef.current = null;
    const live = popupNodeRef.current;
    const anchor =
      clicked && clicked.key === popupKey
        ? clicked.at
        : live
          ? L.latLng(live.lat, live.lon)
          : null;
    if (popupKey == null || !anchor) {
      if (popupRef.current) map.closePopup(popupRef.current);
      popupOpenerRef.current = null;
      return;
    }
    // Read before the popup is attached, so it is still whatever the user acted
    // on — a marker, or the node list row that selected this node.
    const opener = document.activeElement;
    popupOpenerRef.current = opener instanceof HTMLElement ? opener : null;
    popupHadFocusRef.current = false;
    const popup = L.popup({
      className: 'meshcore-popup',
      maxWidth: MAP_POPUP_MAX_WIDTH_PX,
      // Clear of the marker's own glyph, so the tip points at it rather than
      // covering it.
      offset: [0, -MAP_MARKER_SIZE_PX / 2],
      autoPanPadding: [24, 24],
      closeOnClick: false,
      pane: POPUP_PANE,
    })
      .setLatLng(anchor)
      .setContent(popupHost);
    // Claimed before opening: `openOn` closes the popup already showing, and
    // the close handler decides whose close that was by this reference.
    popupRef.current = popup;
    popupKeyRef.current = popupKey;
    popup.openOn(map);

    // A node selected from outside the map has no marker to click, and may
    // still be inside a collapsed cluster — leaving the popup pointing at a
    // count glyph rather than at the node it names. Open the cluster far enough
    // to show the marker itself (zooming in, or fanning the cluster out at the
    // deepest zoom). A marker already on screen short-circuits, so a marker
    // click is unaffected.
    const group = clusterGroupRef.current;
    const marker = markersRef.current.get(popupKey);
    if (group && marker && group.hasLayer(marker)) {
      group.zoomToShowLayer(marker, () => {});
    }
  }, [popupKey, popupHost]);

  // Leaflet names its close button `Close popup` in English and never
  // retranslates it, so it is relabeled here — on open, and again whenever the
  // language changes under an open popup.
  useEffect(() => {
    popupRef.current
      ?.getElement()
      ?.querySelector('.leaflet-popup-close-button')
      ?.setAttribute('aria-label', t('common.close'));
  }, [popupKey, t]);

  // Follow the live node: a fresh advert can move it out from under its own
  // popup, and a node that leaves the plotted set entirely (a filter change,
  // a cache eviction) takes its popup with it rather than anchoring it to
  // empty terrain.
  useEffect(() => {
    if (popupKey == null) return;
    const popup = popupRef.current;
    if (!popup) return;
    // Gone from the plotted set: close it through Leaflet, which reports the
    // close back and clears the state from there.
    if (!popupNode) {
      mapRef.current?.closePopup(popup);
      return;
    }
    const at = popup.getLatLng();
    if (at && (at.lat !== popupNode.lat || at.lng !== popupNode.lon)) {
      popup.setLatLng([popupNode.lat, popupNode.lon]);
    }
  }, [popupKey, popupNode]);

  // Leaflet only listens for Escape while the *map container* holds focus, so
  // a popup whose own button is focused could not be dismissed from the
  // keyboard. React unmounts the body before Leaflet reports the close, so the
  // focus handover has to happen here rather than in `popupclose`. The same
  // listener records that the popup has held focus at all, which is the only
  // trace left once the body is unmounted by a node leaving the plotted set.
  useEffect(() => {
    const onFocusIn = () => {
      popupHadFocusRef.current = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      restorePopupFocus();
      setPopupKey(null);
    };
    popupHost.addEventListener('focusin', onFocusIn);
    popupHost.addEventListener('keydown', onKeyDown);
    return () => {
      popupHost.removeEventListener('focusin', onFocusIn);
      popupHost.removeEventListener('keydown', onKeyDown);
    };
  }, [popupHost, restorePopupFocus, setPopupKey]);

  // Rebuild link polylines when the edge set changes, guarded by a signature so
  // an unrelated node refresh doesn't churn the layer. The zoom is part of that
  // signature because it decides where each label lands.
  useEffect(() => {
    const layer = edgeLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const list = edges ?? [];
    // Only a labeled edge set is zoom-sensitive, so an unlabeled one (the Map
    // page) is not rebuilt on every zoom.
    const labeled = list.some((e) => e.label);
    const sig = `${labeled ? zoom : ''}|${list
      .map(
        (e) =>
          `${e.key}:${e.from[0]},${e.from[1]}:${e.to[0]},${e.to[1]}:${e.label ?? ''}:${e.provisional ? 'p' : ''}`,
      )
      .join('|')}`;
    if (sig === edgeSigRef.current) return;
    edgeSigRef.current = sig;

    layer.clearLayers();
    // Labels are placed in list order, each avoiding the ones before it, so the
    // result is stable for a given edge set rather than depending on paint
    // order.
    const placed: LabelBox[] = [];
    for (const edge of list) {
      const line = L.polyline([edge.from, edge.to], {
        className: 'meshcore-edge',
        weight: MAP_EDGE_WEIGHT,
        opacity: MAP_EDGE_OPACITY,
        // A provisional link has a real SNR but an invented bearing and
        // length, so it is dashed to read as a connection, not a route.
        dashArray: edge.provisional ? '4 5' : undefined,
        interactive: false,
      });
      line.addTo(layer);
      if (!edge.label) continue;
      const fraction = placeEdgeLabel(
        edge.label,
        (f) => map.latLngToLayerPoint(pointAlongEdge(edge.from, edge.to, f)),
        placed,
      );
      // No clear position at this zoom: the link keeps its line, and the label
      // returns once zooming in separates the edges.
      if (fraction === null) continue;
      L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'meshcore-edge-label',
        interactive: false,
      })
        .setLatLng(pointAlongEdge(edge.from, edge.to, fraction))
        .setContent(escapeHtml(edge.label))
        .addTo(layer);
    }
    // `startView` recreates the map with empty layers, so it has to refill.
  }, [edges, startView, zoom]);

  return (
    <div className='meshcore-map relative isolate flex-1'>
      <div ref={containerRef} className='absolute inset-0' />
      {popupNode &&
        renderPopup &&
        createPortal(renderPopup(popupNode, closePopup), popupHost)}
      {children}
    </div>
  );
}
