// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import { useMeshStore } from '@/store/meshStore';
import {
  ROUTE_TYPE_FLOOD,
  PAYLOAD_TYPE_GRP_TXT,
} from '@/lib/meshcore/constants';
import { splitPathHashes } from '@/lib/meshcore/parsers';
import { toHex } from '@/lib/utils';
import type { RawRxPacket } from '@/types/meshcore';

// Counts repeater rebroadcasts of our last channel TX heard in the RX log.
// payloadKey locks onto the first group-text echo after sending; rebroadcasts
// of the same packet carry identical payload bytes.
interface EchoWindow {
  convoId: string;
  msgId: string;
  payloadKey: string | null;
  heard: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

const ECHO_WINDOW_MS = 15000;
// Raw RX-log packets are buffered briefly so an inbound channel message can be
// correlated to the repeater path it traveled (the decoded message frame only
// carries the hop count, never the path bytes). Best-effort: matched by hop
// count within this window.
const RX_PATH_BUFFER_MS = 15000;
const RX_PATH_BUFFER_MAX = 32;

let echoWindow: EchoWindow | null = null;
// Recent group-text RX-log packets awaiting correlation to a decoded inbound
// channel message. Each entry holds the ordered per-hop repeater hashes.
const rxPathBuffer: { hopCount: number; path: string[]; at: number }[] = [];

/** Stops counting repeater echoes of the message the window was opened for. */
export function closeEchoWindow(): void {
  if (echoWindow) clearTimeout(echoWindow.timer);
  echoWindow = null;
}

/**
 * Starts counting repeater rebroadcasts of a just-sent channel message.
 *
 * @remarks
 * Only one window is open at a time — a newer send replaces the previous one,
 * whose echoes are no longer the freshest evidence of reach.
 */
export function openEchoWindow(convoId: string, msgId: string): void {
  closeEchoWindow();
  echoWindow = {
    convoId,
    msgId,
    payloadKey: null,
    heard: new Set(),
    timer: setTimeout(closeEchoWindow, ECHO_WINDOW_MS),
  };
}

// Channel messages are flood-routed group text; only such packets carry a
// meaningful repeater path (a transport-routed packet would surface a wrong
// one). Shared by the echo window and the inbound-correlation buffer.
function isFloodGrpTxt(pkt: RawRxPacket): boolean {
  return (
    pkt.routeType === ROUTE_TYPE_FLOOD &&
    pkt.payloadType === PAYLOAD_TYPE_GRP_TXT &&
    pkt.hopCount >= 1
  );
}

// Correlates a flood group-text RX-log packet to the outbound message whose
// echo window is open, tracking which repeaters rebroadcast it. Returns true
// when the packet is that own-message echo (so it must not also be treated as
// an inbound path candidate).
function handleEchoPacket(pkt: RawRxPacket): boolean {
  const w = echoWindow;
  if (!w || !isFloodGrpTxt(pkt)) return false;
  const key = toHex(pkt.payload);
  if (w.payloadKey === null) w.payloadKey = key;
  else if (w.payloadKey !== key) return false;
  // The repeater that just rebroadcast is the last hash appended to the path
  const lastHop = toHex(pkt.path.slice(-pkt.hashSize));
  if (!w.heard.has(lastHop)) {
    w.heard.add(lastHop);
    useMeshStore.getState().updateMessage(w.convoId, w.msgId, {
      heardByRepeaters: w.heard.size,
      heardVia: Array.from(w.heard),
    });
  }
  return true;
}

// Records a flood group-text RX-log packet so a soon-to-arrive decoded channel
// message can adopt its repeater path. Old entries are pruned by age and count.
function bufferRxPath(pkt: RawRxPacket): void {
  if (!isFloodGrpTxt(pkt)) return;
  const now = Date.now();
  while (rxPathBuffer.length && now - rxPathBuffer[0].at > RX_PATH_BUFFER_MS) {
    rxPathBuffer.shift();
  }
  rxPathBuffer.push({
    hopCount: pkt.hopCount,
    path: splitPathHashes(pkt.path, pkt.hashSize),
    at: now,
  });
  if (rxPathBuffer.length > RX_PATH_BUFFER_MAX) rxPathBuffer.shift();
}

/**
 * Pops the most recent buffered repeater path whose hop count matches a
 * decoded inbound message.
 *
 * @returns the ordered per-hop repeater hashes, or undefined when nothing
 * correlates. Best-effort — the frame carries no path of its own.
 */
export function matchRxPath(hopCount: number): string[] | undefined {
  const now = Date.now();
  for (let i = rxPathBuffer.length - 1; i >= 0; i--) {
    const e = rxPathBuffer[i];
    if (now - e.at > RX_PATH_BUFFER_MS) continue;
    if (e.hopCount === hopCount) {
      rxPathBuffer.splice(i, 1);
      return e.path.length ? e.path : undefined;
    }
  }
  return undefined;
}

/**
 * Single onLogRx sink.
 *
 * @remarks
 * An own-message echo is consumed by the echo window and stops there; anything
 * else is buffered as an inbound path candidate. Routing echoes away from the
 * buffer keeps our own send's repeaters from being mis-attributed to an inbound
 * message that happens to share its hop count.
 */
export function handleLogRx(pkt: RawRxPacket): void {
  if (handleEchoPacket(pkt)) return;
  bufferRxPath(pkt);
}

/** Drops the open echo window and every buffered inbound path candidate. */
export function resetRxCorrelation(): void {
  closeEchoWindow();
  rxPathBuffer.length = 0;
}
