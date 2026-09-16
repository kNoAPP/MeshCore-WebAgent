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
import { useMeshStore } from '@/store/meshStore';
import { escapeHtml, nodeIcon } from '@/lib/map/leafletIcon';
import {
  placeEdgeLabel,
  pointAlongEdge,
  type LabelBox,
} from '@/lib/map/edgeLabel';
import type { MapEdge, MapNode } from '@/lib/map/nodes';
import {
  MAP_EDGE_OPACITY,
  MAP_EDGE_WEIGHT,
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
  const edgeLayerRef = useRef<L.LayerGroup | null>(null);
  // Signatures of the currently plotted markers/edges; let the rebuild effects
  // skip work when nothing changed. Reset whenever a layer is (re)created so a
  // fresh, empty layer is always repopulated (e.g. StrictMode's remount).
  const markerSigRef = useRef<string>('');
  const edgeSigRef = useRef<string>('');
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  // Held in refs so their identity churn never re-runs the create effect (which
  // would tear down and rebuild the whole map). `interactive` still feeds the
  // marker signature so wiring toggles when a handler is added/removed.
  const onNodeClickRef = useRef(onNodeClick);
  const renderPopupRef = useRef(renderPopup);
  const onMoveEndRef = useRef(onMoveEnd);
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    renderPopupRef.current = renderPopup;
    onMoveEndRef.current = onMoveEnd;
    onMapReadyRef.current = onMapReady;
  });

  // The node whose popup is open, or null. The popup body is React, rendered
  // through a portal into this detached host, which Leaflet then adopts as the
  // popup's content — so the body keeps the app's store, theme and i18n
  // instead of being assembled as an HTML string.
  const [popupNode, setPopupNode] = useState<MapNode | null>(null);
  const [popupHost] = useState(() => document.createElement('div'));
  // The marker element the open popup was launched from, so a keyboard close
  // hands focus back to it rather than dropping it on the document.
  const popupSourceRef = useRef<HTMLElement | null>(null);
  const closePopup = useCallback(() => setPopupNode(null), []);
  // Only when focus is still inside the popup being closed: a close that came
  // from clicking the map (or from opening another marker's popup) has already
  // put focus where the user meant it to go.
  const restorePopupFocus = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest('.leaflet-popup')) {
      return;
    }
    const source = popupSourceRef.current;
    if (source?.isConnected) source.focus();
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
    // this programmatic move never reports a move for a user who hasn't panned.
    applyStartView(map, startView);

    // Edges sit under markers so a node's shape always reads on top of its
    // links.
    edgeLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
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
    // of it — covering the close button and any Leaflet-initiated close.
    const onPopupClose = () => {
      restorePopupFocus();
      setPopupNode(null);
    };
    map.on('popupclose', onPopupClose);

    onMapReadyRef.current?.(map);

    return () => {
      onMapReadyRef.current?.(null);
      map.off('moveend', onMove);
      map.off('autopanstart', onAutoPan);
      map.off('zoomend', onZoom);
      map.off('popupclose', onPopupClose);
      map.off('resize', clampMinZoom);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      edgeLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, [startView, restorePopupFocus]);

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
    // so both belong in the signature that decides whether a rebuild is needed.
    const fullSig = `${clickable ? 'click' : ''}|${t('map.self')}|${sig}`;
    if (fullSig === markerSigRef.current) return;
    markerSigRef.current = fullSig;

    layer.clearLayers();
    for (const node of nodes) {
      // A node parked on the unplaced ring sits at an invented coordinate and
      // is known only by its prefix, so there is nothing for a click to open.
      const inert = !(
        clickable &&
        node.kind !== 'self' &&
        !node.positionUnknown
      );
      const name = node.kind === 'self' ? t('map.self') : node.name;
      const marker = L.marker([node.lat, node.lon], {
        icon: nodeIcon(node),
        // An inert marker (location-pick mode, or the self node) would
        // otherwise swallow the click the map needs to place the pin, and
        // would be a dead stop for the keyboard.
        bubblingMouseEvents: inert,
        keyboard: !inert,
        // Leaflet puts this on the container, which is what names the button
        // it makes of an interactive marker.
        title: inert ? undefined : name,
      });
      marker.bindTooltip(escapeHtml(name), { direction: 'top' });
      if (!inert) {
        marker.on('click', () => {
          if (!renderPopupRef.current) {
            onNodeClickRef.current?.(node);
            return;
          }
          popupSourceRef.current = marker.getElement() ?? null;
          setPopupNode(node);
        });
      }
      marker.addTo(layer);
    }
    // `startView` recreates the map with empty layers, so it has to refill.
  }, [nodes, t, clickable, startView]);

  // Open the popup for the clicked node, anchored at its coordinates. It is
  // added to the map rather than bound to the marker, so the frequent marker
  // rebuilds a busy advert cache causes can't close it mid-read. Leaflet closes
  // the previous popup as this one opens, and clearing the node closes the
  // last one — whether that came from an action or from `popupclose` itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!popupNode) {
      map.closePopup();
      return;
    }
    L.popup({
      className: 'meshcore-popup',
      maxWidth: MAP_POPUP_MAX_WIDTH_PX,
      // Clear of the marker's own glyph, so the tip points at it rather than
      // covering it.
      offset: [0, -MAP_MARKER_SIZE_PX / 2],
      autoPanPadding: [24, 24],
    })
      .setLatLng([popupNode.lat, popupNode.lon])
      .setContent(popupHost)
      .openOn(map);
  }, [popupNode, popupHost]);

  // Leaflet only listens for Escape while the *map container* holds focus, so
  // a popup whose own button is focused could not be dismissed from the
  // keyboard. React unmounts the body before Leaflet reports the close, so the
  // focus handover has to happen here rather than in `popupclose`.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      restorePopupFocus();
      setPopupNode(null);
    };
    popupHost.addEventListener('keydown', onKeyDown);
    return () => popupHost.removeEventListener('keydown', onKeyDown);
  }, [popupHost, restorePopupFocus]);

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
