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
  roomConvoId,
  isAuthedLogin,
} from '@/store/meshStore';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  FAVORITE_FLAG,
  NO_PATH,
} from '@/lib/meshcore/constants';
import { SUPPORTED_LOCALES, LOCALE_NAMES } from '@/lib/i18n/config';
import { SUPPORTED_UNIT_SYSTEMS } from '@/lib/units/config';
import type { ActiveConvo, Contact } from '@/types/meshcore';
import {
  buildAdvertRecords,
  buildChannelRecords,
  buildContactRecords,
  buildMessageRecords,
  actionPattern,
  ACTION_FUSE_OPTIONS,
  ACTION_TARGETS,
  ADVERT_FUSE_OPTIONS,
  CHANNEL_FUSE_OPTIONS,
  CONTACT_FUSE_OPTIONS,
  CONTACT_VERBS,
  MESSAGE_FUSE_OPTIONS,
  PAGE_FUSE_OPTIONS,
  PAGE_TARGETS,
  type ActionRecord,
  type AdvertRecord,
  type ChannelRecord,
  type CommandResult,
  type ContactRecord,
  type ContactVerb,
  type MessageRecord,
  type PageRecord,
  type PaletteAction,
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
  key:
    | 'recent'
    | 'actions'
    | 'messages'
    | 'contacts'
    | 'adverts'
    | 'channels'
    | 'pages';
  /** i18n key for the group heading. */
  headingKey:
    | 'command.group.recent'
    | 'command.group.actions'
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

// A verb the target UI would render disabled has nothing to offer here: a
// contact with no stored path cannot have one reset.
function verbApplies(verb: ContactVerb, contact: Contact): boolean {
  if (verb === 'route') return contact.outPathLen !== NO_PATH;
  return true;
}

function contactVerbLabelKey(
  verb: ContactVerb,
  contact: Contact,
): `command.action.contact_${ContactVerb | 'unfavorite'}` {
  if (verb === 'favorite' && (contact.flags & FAVORITE_FLAG) !== 0) {
    return 'command.action.contact_unfavorite';
  }
  return `command.action.contact_${verb}`;
}

function contactVerbRun(verb: ContactVerb, prefix: string): PaletteAction {
  switch (verb) {
    case 'favorite':
      return { kind: 'contactFavorite', prefix };
    case 'route':
      return { kind: 'contactResetRoute', prefix };
    case 'share':
      return { kind: 'contactShare', prefix };
  }
}

function actionResult(record: ActionRecord): CommandResult {
  return {
    kind: 'action',
    id: record.id,
    primary: record.label,
    secondary: record.hint,
    destructive: record.destructive,
    action: record.action,
  };
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
  const locale = useMeshStore((s) => s.locale);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const adminSessions = useMeshStore((s) => s.adminSessions);
  const advertising = useMeshStore((s) => s.advertising);

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
      if (kind === 'room') {
        const contact = contacts[rawId];
        const label = contact?.name || rawId.slice(0, 8);
        return { kind: 'room', id: convoId, rawId, label };
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
      // Repeaters open the main-window admin view and rooms their post feed,
      // not a chat.
      const advType = contacts[prefix]?.advType;
      if (advType === ADV_TYPE_REPEATER) {
        return {
          kind: 'repeater',
          id: repeaterConvoId(prefix),
          rawId: prefix,
          label,
        };
      }
      if (advType === ADV_TYPE_ROOM) {
        return { kind: 'room', id: roomConvoId(prefix), rawId: prefix, label };
      }
      return {
        kind: 'direct',
        id: directConvoId(prefix),
        rawId: prefix,
        label,
      };
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

  // The radio-wide verbs, which are also what the empty-query launcher offers.
  const radioActionRecords = useMemo<ActionRecord[]>(
    () =>
      ACTION_TARGETS.filter(
        // A broadcast in flight disables the header's advertise control, and
        // the same lock would swallow this one. Offering a row that does
        // nothing is worse than not offering it.
        (target) => !(advertising && target.run.kind === 'advertise'),
      ).map((target) => ({
        id: `action:${target.id}`,
        label: t(`command.action.${target.id}`),
        keywords: t(`command.actionKeywords.${target.id}`),
        destructive: 'destructive' in target ? target.destructive : undefined,
        action: { type: 'run', run: target.run },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, advertising],
  );

  // Switching to the value that is already active is a no-op, so only the
  // alternatives are offered.
  const displayActionRecords = useMemo<ActionRecord[]>(() => {
    const records: ActionRecord[] = [];
    for (const l of SUPPORTED_LOCALES) {
      if (l === locale) continue;
      records.push({
        id: `action:locale:${l}`,
        label: t('command.action.setLanguage', { language: LOCALE_NAMES[l] }),
        keywords: t('command.actionKeywords.setLanguage'),
        action: { type: 'run', run: { kind: 'setLocale', locale: l } },
      });
    }
    for (const u of SUPPORTED_UNIT_SYSTEMS) {
      if (u === unitSystem) continue;
      records.push({
        id: `action:units:${u}`,
        label: t('command.action.setUnits', {
          units: t(`settings.units_${u}`),
        }),
        keywords: t('command.actionKeywords.setUnits'),
        action: { type: 'run', run: { kind: 'setUnitSystem', unitSystem: u } },
      });
    }
    return records;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, unitSystem, language]);

  // One row per contact per applicable verb, so "reset route on Gold-Saddle"
  // ranks as a single result instead of needing the Manage modal.
  const contactActionRecords = useMemo<ActionRecord[]>(() => {
    const records: ActionRecord[] = [];
    for (const contact of Object.values(contacts)) {
      const name = contact.name || contact.pubkeyPrefix.slice(0, 8);
      for (const verb of CONTACT_VERBS) {
        if (!verbApplies(verb, contact)) continue;
        records.push({
          id: `action:contact:${verb}:${contact.pubkeyPrefix}`,
          label: t(contactVerbLabelKey(verb, contact), { name }),
          keywords: t(`command.actionKeywords.contact_${verb}`),
          hint: name,
          action: {
            type: 'run',
            run: contactVerbRun(verb, contact.pubkeyPrefix),
          },
        });
      }
    }
    return records;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, language]);

  // Scoped to the repeater/room admin session that is actually open — these
  // verbs have no meaning without one, and the target UI hides them too.
  const repeaterActionRecords = useMemo<ActionRecord[]>(() => {
    if (activeConvo?.kind !== 'repeater' && activeConvo?.kind !== 'room') {
      return [];
    }
    const prefix = String(activeConvo.rawId);
    if (!isAuthedLogin(adminSessions[prefix]?.login)) return [];
    return [
      {
        id: `action:repeater:status:${prefix}`,
        label: t('command.action.repeaterStatus'),
        keywords: t('command.actionKeywords.repeaterStatus'),
        hint: activeConvo.label,
        action: { type: 'run', run: { kind: 'repeaterStatus', prefix } },
      },
      {
        id: `action:repeater:logout:${prefix}`,
        label: t('command.action.repeaterLogOut'),
        keywords: t('command.actionKeywords.repeaterLogOut'),
        hint: activeConvo.label,
        action: { type: 'run', run: { kind: 'repeaterLogOut', prefix } },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvo, adminSessions, language]);

  const actionRecords = useMemo(
    () => [
      ...radioActionRecords,
      ...displayActionRecords,
      ...repeaterActionRecords,
      ...contactActionRecords,
    ],
    [
      radioActionRecords,
      displayActionRecords,
      repeaterActionRecords,
      contactActionRecords,
    ],
  );
  const actionFuse = useMemo(
    () => new Fuse<ActionRecord>(actionRecords, ACTION_FUSE_OPTIONS),
    [actionRecords],
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
      } else if (kind === 'direct' || kind === 'room') {
        const contact = contacts[rawId];
        convo = {
          kind,
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
        key: 'actions',
        headingKey: 'command.group.actions',
        results: [...radioActionRecords, ...displayActionRecords].map(
          actionResult,
        ),
      });
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

    const pattern = actionPattern(trimmed);
    const actionResults = pattern
      ? actionFuse
          .search(pattern, { limit: GROUP_LIMIT })
          .map<CommandResult>((r) => actionResult(r.item))
      : [];
    if (actionResults.length) {
      groups.push({
        key: 'actions',
        headingKey: 'command.group.actions',
        results: actionResults,
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
    actionFuse,
    pageFuse,
    pageRecords,
    radioActionRecords,
    displayActionRecords,
    recentConversations,
  ]);
}
