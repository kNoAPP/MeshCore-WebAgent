// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMemo } from 'react';
import Fuse, { type FuseResult } from 'fuse.js';
import { useTranslation } from 'react-i18next';
import {
  useMeshStore,
  channelConvoId,
  directConvoId,
  repeaterConvoId,
} from '@/store/meshStore';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import type { ActiveConvo } from '@/types/meshcore';
import {
  buildAdvertRecords,
  buildChannelRecords,
  buildContactRecords,
  buildMessageRecords,
  ADVERT_FUSE_OPTIONS,
  CHANNEL_FUSE_OPTIONS,
  CONTACT_FUSE_OPTIONS,
  MESSAGE_FUSE_OPTIONS,
  PAGE_FUSE_OPTIONS,
  PAGE_TARGETS,
  type AdvertRecord,
  type ChannelRecord,
  type CommandResult,
  type ContactRecord,
  type MessageRecord,
  type PageRecord,
} from '@/lib/search/commandSearch';

// Bounded so a huge history stays responsive.
const MESSAGE_SCAN_CAP = 2000;

const GROUP_LIMIT = 6;
// Messages are the primary use case, so they get a larger cap.
const MESSAGE_LIMIT = 8;
const RECENT_LIMIT = 6;

/** A titled block of results the palette renders as one section. */
export interface CommandGroup {
  /** Stable key and heading discriminator. */
  key: 'recent' | 'messages' | 'contacts' | 'adverts' | 'channels' | 'pages';
  /** i18n key for the group heading. */
  headingKey:
    | 'command.group.recent'
    | 'command.group.messages'
    | 'command.group.contacts'
    | 'command.group.adverts'
    | 'command.group.channels'
    | 'command.group.pages';
  results: CommandResult[];
}

function highlightFor(
  result: FuseResult<MessageRecord>,
  key: string,
): CommandResult['highlight'] {
  return result.matches?.find((m) => m.key === key)?.indices;
}

function messageHint(record: MessageRecord): string {
  return record.sender
    ? `${record.sender} · ${record.convo.label}`
    : record.convo.label;
}

/**
 * Builds a memoized Fuse index over the store's messages, contacts, channels,
 * and static navigation targets, and returns ranked results grouped by kind for
 * `query`. An empty query yields recent conversations plus page shortcuts, so
 * the palette doubles as a launcher.
 *
 * @param query - the raw search text; trimmed here.
 * @returns non-empty groups in display order.
 */
export function useCommandSearch(query: string): CommandGroup[] {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const contacts = useMeshStore((s) => s.contacts);
  const channels = useMeshStore((s) => s.channels);
  const advertCache = useMeshStore((s) => s.advertCache);

  // Rebuild indexes only when the underlying slices (or language, which drives
  // fallback labels) change — not on every keystroke.
  const messageFuse = useMemo(() => {
    const resolveConvo = (convoId: string): ActiveConvo | null => {
      const [kind, rawId] = convoId.split(/:(.*)/s);
      if (kind === 'channel') {
        const idx = Number(rawId);
        const ch = channels[idx];
        const label = ch?.name || t('common.channelName', { index: idx });
        return { kind: 'channel', id: convoId, rawId: idx, label };
      }
      if (kind === 'direct') {
        const contact = contacts[rawId];
        const label = contact?.name || rawId.slice(0, 8);
        return { kind: 'direct', id: convoId, rawId, label };
      }
      return null;
    };
    const records = buildMessageRecords(
      msgHistory,
      resolveConvo,
      MESSAGE_SCAN_CAP,
    );
    return new Fuse<MessageRecord>(records, MESSAGE_FUSE_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgHistory, channels, contacts, language]);

  const contactFuse = useMemo(() => {
    const records = buildContactRecords(contacts, (prefix, label) => {
      // Repeaters and room servers open the main-window admin view, not a chat.
      const advType = contacts[prefix]?.advType;
      const isAdminNode =
        advType === ADV_TYPE_REPEATER || advType === ADV_TYPE_ROOM;
      return isAdminNode
        ? {
            kind: 'repeater',
            id: repeaterConvoId(prefix),
            rawId: prefix,
            label,
          }
        : { kind: 'direct', id: directConvoId(prefix), rawId: prefix, label };
    });
    return new Fuse<ContactRecord>(records, CONTACT_FUSE_OPTIONS);
  }, [contacts]);

  // The advert cache gets a fresh reference on every heard batch (many per
  // second on a busy mesh), but a batch that only bumps `lastHeard` changes
  // neither the searchable name nor the key set. Key the (comparatively
  // expensive) Fuse rebuild on the record content so the index isn't
  // reconstructed under the user mid-search — only when a name or the node set
  // actually changes.
  const advertRecords = useMemo(
    () => buildAdvertRecords(advertCache, contacts),
    [advertCache, contacts],
  );
  const advertSig = useMemo(
    () => advertRecords.map((r) => `${r.prefix}:${r.name}`).join('|'),
    [advertRecords],
  );
  const advertFuse = useMemo(
    () => new Fuse<AdvertRecord>(advertRecords, ADVERT_FUSE_OPTIONS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [advertSig],
  );

  const channelFuse = useMemo(() => {
    const records = buildChannelRecords(
      channels,
      (idx, label) => ({
        kind: 'channel',
        id: channelConvoId(idx),
        rawId: idx,
        label,
      }),
      (idx) => t('common.channelName', { index: idx }),
    );
    return new Fuse<ChannelRecord>(records, CHANNEL_FUSE_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, language]);

  const pageRecords = useMemo<PageRecord[]>(
    () =>
      PAGE_TARGETS.map((target) => {
        const section = 'section' in target ? target.section : undefined;
        return {
          id: target.id,
          label: t(`command.page.${target.id}`),
          keywords: t(`command.keywords.${target.id}`),
          action: {
            type: 'page',
            view: target.view,
            ...(section ? { section } : {}),
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  const pageFuse = useMemo(
    () => new Fuse<PageRecord>(pageRecords, PAGE_FUSE_OPTIONS),
    [pageRecords],
  );

  // The most recently active conversations, for the empty-query launcher view.
  const recentConversations = useMemo(() => {
    const latest = new Map<string, { convo: ActiveConvo; ts: number }>();
    for (const [convoId, msgs] of Object.entries(msgHistory)) {
      if (!msgs.length) continue;
      const [kind, rawId] = convoId.split(/:(.*)/s);
      let convo: ActiveConvo | null = null;
      if (kind === 'channel') {
        const idx = Number(rawId);
        const ch = channels[idx];
        convo = {
          kind: 'channel',
          id: convoId,
          rawId: idx,
          label: ch?.name || t('common.channelName', { index: idx }),
        };
      } else if (kind === 'direct') {
        const contact = contacts[rawId];
        convo = {
          kind: 'direct',
          id: convoId,
          rawId,
          label: contact?.name || rawId.slice(0, 8),
        };
      }
      if (!convo) continue;
      let ts = 0;
      for (const m of msgs) if ((m.timestamp ?? 0) > ts) ts = m.timestamp ?? 0;
      latest.set(convoId, { convo, ts });
    }
    return [...latest.values()]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RECENT_LIMIT)
      .map((e) => e.convo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgHistory, channels, contacts, language]);

  return useMemo(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      const groups: CommandGroup[] = [];
      if (recentConversations.length) {
        groups.push({
          key: 'recent',
          headingKey: 'command.group.recent',
          results: recentConversations.map((convo) => ({
            kind: convo.kind === 'channel' ? 'channel' : 'contact',
            id: `recent:${convo.id}`,
            primary: convo.label,
            action: { type: 'convo', convo },
          })),
        });
      }
      groups.push({
        key: 'pages',
        headingKey: 'command.group.pages',
        results: pageRecords.map((doc) => ({
          kind: 'page',
          id: `page:${doc.id}`,
          primary: doc.label,
          action: doc.action,
        })),
      });
      return groups;
    }

    const groups: CommandGroup[] = [];

    const messages = messageFuse
      .search(trimmed, { limit: MESSAGE_LIMIT })
      .map<CommandResult>((r) => ({
        kind: 'message',
        id: `msg:${r.item.msgId}`,
        primary: r.item.body,
        secondary: messageHint(r.item),
        timestamp: r.item.timestamp,
        highlight: highlightFor(r, 'body'),
        action: { type: 'message', convo: r.item.convo, msgId: r.item.msgId },
      }));
    if (messages.length) {
      groups.push({
        key: 'messages',
        headingKey: 'command.group.messages',
        results: messages,
      });
    }

    const contactResults = contactFuse
      .search(trimmed, { limit: GROUP_LIMIT })
      .map<CommandResult>((r) => ({
        kind: 'contact',
        id: `contact:${r.item.prefix}`,
        primary: r.item.name,
        secondary: r.item.prefix.slice(0, 12),
        action: { type: 'convo', convo: r.item.convo },
      }));
    if (contactResults.length) {
      groups.push({
        key: 'contacts',
        headingKey: 'command.group.contacts',
        results: contactResults,
      });
    }

    const advertResults = advertFuse
      .search(trimmed, { limit: GROUP_LIMIT })
      .map<CommandResult>((r) => ({
        kind: 'advert',
        id: `advert:${r.item.prefix}`,
        primary: r.item.name,
        secondary: r.item.prefix.slice(0, 12),
        action: { type: 'advert', prefix: r.item.prefix },
      }));
    if (advertResults.length) {
      groups.push({
        key: 'adverts',
        headingKey: 'command.group.adverts',
        results: advertResults,
      });
    }

    const channelResults = channelFuse
      .search(trimmed, { limit: GROUP_LIMIT })
      .map<CommandResult>((r) => ({
        kind: 'channel',
        id: `channel:${r.item.convo.rawId}`,
        primary: r.item.name,
        secondary: r.item.indexLabel,
        action: { type: 'convo', convo: r.item.convo },
      }));
    if (channelResults.length) {
      groups.push({
        key: 'channels',
        headingKey: 'command.group.channels',
        results: channelResults,
      });
    }

    const pageResults = pageFuse
      .search(trimmed, { limit: GROUP_LIMIT })
      .map<CommandResult>((r) => ({
        kind: 'page',
        id: `page:${r.item.id}`,
        primary: r.item.label,
        action: r.item.action,
      }));
    if (pageResults.length) {
      groups.push({
        key: 'pages',
        headingKey: 'command.group.pages',
        results: pageResults,
      });
    }

    return groups;
  }, [
    query,
    messageFuse,
    contactFuse,
    advertFuse,
    channelFuse,
    pageFuse,
    pageRecords,
    recentConversations,
  ]);
}
