// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMeshStore } from '@/store/meshStore';
import { escapeHtml, nodeIcon } from '@/lib/map/leafletIcon';
import type { MapEdge, MapNode } from '@/lib/map/nodes';
import {
  MAP_EDGE_OPACITY,
  MAP_EDGE_WEIGHT,
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
   * Ignored for nodes {@link nodeActions} offers a popup for.
   */
  onNodeClick?: (node: MapNode) => void;
  /**
   * Actions offered in a node's on-map popup. Returning an empty list (or
   * omitting this) falls back to {@link onNodeClick}. A popup keeps the map
   * visible, which a modal over it does not.
   */
  nodeActions?: (node: MapNode) => NodeAction[];
  /** Invoked after each pan/zoom, for callers that persist the viewport. */
  onMoveEnd?: (center: [number, number], zoom: number) => void;
  /**
   * Receives the Leaflet map on creation and `null` on teardown, so a wrapper
   * can wire imperative behavior (e.g. click-to-place picking) against it.
   */
  onMapReady?: (map: L.Map | null) => void;
  /**
   * Whether the wheel zooms the map. Off for a map embedded in a scrolling
   * pane, where wheeling should scroll the pane instead. Defaults to `true`.
   */
  scrollWheelZoom?: boolean;
  /** Overlays rendered above the map (banners, legend, cap notice). */
  children?: ReactNode;
}

/** One entry in a marker's popup. */
export interface NodeAction {
  /** Stable identifier, used to route the popup's click back here. */
  key: string;
  label: string;
  onSelect: (node: MapNode) => void;
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
  nodeActions,
  onMoveEnd,
  onMapReady,
  scrollWheelZoom = true,
  children,
}: BaseLeafletMapProps) {
  const { t } = useTranslation();
  const theme = useMeshStore((s) => s.theme);

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
  // would tear down and rebuild the whole map). `clickable` still feeds the
  // marker signature so wiring toggles when a handler is added/removed.
  const onNodeClickRef = useRef(onNodeClick);
  const nodeActionsRef = useRef(nodeActions);
  const onMoveEndRef = useRef(onMoveEnd);
  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    nodeActionsRef.current = nodeActions;
    onMoveEndRef.current = onMoveEnd;
    onMapReadyRef.current = onMapReady;
  });

  // Create the map once per opening viewport.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      // Lock to a single world so markers (which Leaflet renders only on the
      // primary copy) can't disagree with a basemap repeated at low zoom. The
      // opening viewport is applied below, once the min zoom is known.
      maxBounds: WORLD_BOUNDS,
      maxBoundsViscosity: 1,
      scrollWheelZoom,
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
    // The `bounds` case frames every located node; `maxZoom` keeps a single
    // node (or a tight cluster) from slamming all the way to street level.
    if ('bounds' in startView) {
      map.fitBounds(startView.bounds, { padding: [40, 40], maxZoom: 13 });
    } else {
      map.setView(startView.center, startView.zoom);
    }

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
        maxZoom: 20,
        noWrap: true,
        detectRetina: true,
      },
    ).addTo(map);

    const onMove = () => {
      const c = map.getCenter();
      onMoveEndRef.current?.([c.lat, c.lng], map.getZoom());
    };
    map.on('moveend', onMove);

    onMapReadyRef.current?.(map);

    return () => {
      onMapReadyRef.current?.(null);
      map.off('moveend', onMove);
      map.off('resize', clampMinZoom);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      edgeLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, [startView, scrollWheelZoom]);

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
  const clickable = onNodeClick != null;
  const hasNodeActions = nodeActions != null;
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    const actionsFor = (n: MapNode) =>
      n.kind === 'self' ? [] : (nodeActionsRef.current?.(n) ?? []);
    const sig = nodes
      .map(
        (n) =>
          `${n.kind}:${n.key}:${n.lat}:${n.lon}:${n.advType}:${n.favorite ? 1 : 0}:${n.name}:${actionsFor(
            n,
          )
            .map((a) => `${a.key}=${a.label}`)
            .join(',')}`,
      )
      .join('|');
    // `t` (locale) drives the self tooltip and `clickable` gates click wiring,
    // so both belong in the signature that decides whether a rebuild is needed.
    const fullSig = `${clickable ? 'click' : ''}|${hasNodeActions ? 'actions' : ''}|${t('map.self')}|${sig}`;
    if (fullSig === markerSigRef.current) return;
    markerSigRef.current = fullSig;

    layer.clearLayers();
    for (const node of nodes) {
      const marker = L.marker([node.lat, node.lon], {
        icon: nodeIcon(node),
        // Without a popup or click handler (location-pick mode) a marker would
        // otherwise swallow the click the map needs to place the pin.
        bubblingMouseEvents: !clickable && !hasNodeActions,
      });
      const label =
        node.kind === 'self' ? t('map.self') : escapeHtml(node.name);
      marker.bindTooltip(label, { direction: 'top' });
      const actions = actionsFor(node);
      if (actions.length > 0) {
        // A popup rather than a modal: the point of a spatial view is that the
        // map you clicked from stays on screen. The markup is built from the
        // escaped node name and our own action keys, never raw input.
        const buttons = actions
          .map(
            (a) =>
              `<button type="button" class="meshcore-popup-action" data-action="${escapeHtml(a.key)}">${escapeHtml(a.label)}</button>`,
          )
          .join('');
        marker.bindPopup(
          `<div class="meshcore-popup-title">${label}</div><div class="meshcore-popup-actions">${buttons}</div>`,
          { closeButton: true, minWidth: 140 },
        );
        marker.on('popupopen', (e) => {
          const root = e.popup.getElement();
          root?.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
            // Assigned, not added: Leaflet reuses the popup's elements, so an
            // `addEventListener` per open would stack up and fire one click
            // once per time the popup had been opened.
            el.onclick = () => {
              const key = el.dataset.action;
              const live = nodeActionsRef.current?.(node) ?? [];
              live.find((a) => a.key === key)?.onSelect(node);
              marker.closePopup();
            };
          });
        });
      } else if (clickable && node.kind !== 'self') {
        marker.on('click', () => onNodeClickRef.current?.(node));
      }
      marker.addTo(layer);
    }
    // `startView` recreates the map with empty layers, so it has to refill.
  }, [nodes, t, clickable, hasNodeActions, startView]);

  // Rebuild link polylines when the edge set changes, guarded by a signature so
  // an unrelated node refresh doesn't churn the layer.
  useEffect(() => {
    const layer = edgeLayerRef.current;
    if (!layer) return;
    const list = edges ?? [];
    const sig = list
      .map(
        (e) =>
          `${e.key}:${e.from[0]},${e.from[1]}:${e.to[0]},${e.to[1]}:${e.label ?? ''}`,
      )
      .join('|');
    if (sig === edgeSigRef.current) return;
    edgeSigRef.current = sig;

    layer.clearLayers();
    for (const edge of list) {
      const line = L.polyline([edge.from, edge.to], {
        className: 'meshcore-edge',
        weight: MAP_EDGE_WEIGHT,
        opacity: MAP_EDGE_OPACITY,
        interactive: false,
      });
      if (edge.label) {
        line.bindTooltip(escapeHtml(edge.label), {
          permanent: true,
          direction: 'center',
          className: 'meshcore-edge-label',
        });
      }
      line.addTo(layer);
    }
    // `startView` recreates the map with empty layers, so it has to refill.
  }, [edges, startView]);

  return (
    <div className='meshcore-map relative isolate flex-1'>
      <div ref={containerRef} className='absolute inset-0' />
      {children}
    </div>
  );
}
