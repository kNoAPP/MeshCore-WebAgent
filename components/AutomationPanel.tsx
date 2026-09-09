// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ShieldAlert, Check, X } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { ModalShell } from '@/components/ModalShell';
import {
  automationEngine,
  DEFAULT_MAX_TURNS,
  MIN_MAX_TURNS,
  MAX_MAX_TURNS,
  UNLIMITED_TURNS,
  DEFAULT_MAX_TOKENS,
  MIN_MAX_TOKENS,
  MAX_MAX_TOKENS,
  MAX_COOLDOWN_SEC,
} from '@/lib/ai/engine';
import { TOOL_NAMES, toolClass, type ToolName } from '@/lib/ai/tools';
import { isValidCron } from '@/lib/ai/cron';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
} from '@/lib/meshcore/constants';
import type {
  AutomationRule,
  RuleAction,
  RuleTrigger,
} from '@/types/automation';

const TRIGGER_KINDS: RuleTrigger['on'][] = [
  'message',
  'advert',
  'ack',
  'connection',
  'schedule',
];

// "Chat" covers both the companion type and the "none" default (advType 0/1);
// the rest are one-to-one.
const ADV_TYPE_FILTERS: {
  key: 'chat' | 'repeater' | 'room' | 'sensor';
  types: number[];
}[] = [
  { key: 'chat', types: [0, 1] },
  { key: 'repeater', types: [ADV_TYPE_REPEATER] },
  { key: 'room', types: [ADV_TYPE_ROOM] },
  { key: 'sensor', types: [ADV_TYPE_SENSOR] },
];

/**
 * The Automation settings card body (task 6.4): master switch + kill switch,
 * the approval inbox, the rule list/editor, and the audit log. Rules react to
 * live mesh events and take radio actions behind the guardrails — human-in-the-
 * loop by default, per-rule autonomy opt-in, allowlist, airtime rate limiting,
 * and this always-reachable kill switch.
 */
export function AutomationSettingsBody() {
  const { t } = useTranslation();
  const enabled = useMeshStore((s) => s.automationEnabled);
  const setEnabled = useMeshStore((s) => s.setAutomationEnabled);
  const killSwitch = useMeshStore((s) => s.killSwitch);
  const rules = useMeshStore((s) => s.automationRules);
  const staged = useMeshStore((s) => s.stagedActions);

  // The rule currently loaded into the editor for changes, or null when adding
  // a new one. Lifted here so the list's Edit button and the editor share it.
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  // Whether the rule editor dialog is open. Kept separate from `editing` so a
  // null `editing` means "new rule" rather than "closed".
  const [editorOpen, setEditorOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: AutomationRule) => {
    setEditing(rule);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-xs text-(--text2)'>{t('automation.hint')}</p>
      <p className='rounded-md border border-(--border) px-2.5 py-2 text-[11px] text-(--text2)'>
        {t('automation.liveOnly')}
      </p>

      <div className='flex items-center justify-between gap-2'>
        <button
          role='switch'
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className='flex flex-1 items-center justify-between gap-2 text-left text-xs text-(--text)'
        >
          <span className='flex flex-col'>
            <span className='font-semibold'>{t('automation.master')}</span>
            <span className='text-[11px] text-(--text2)'>
              {enabled ? t('automation.on') : t('automation.off')}
            </span>
          </span>
          <span
            className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
            style={{ background: enabled ? 'var(--accent)' : 'var(--border)' }}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
                enabled ? 'left-3.5' : 'left-0.5'
              }`}
            />
          </span>
        </button>
        <button
          onClick={() => killSwitch()}
          disabled={!enabled && staged.length === 0}
          className='flex shrink-0 items-center gap-1.5 rounded-md border border-(--red) px-3 py-1.5 text-xs font-semibold text-(--red) hover:bg-(--red-solid) hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-(--red)'
        >
          <ShieldAlert size={14} />
          {t('automation.kill')}
        </button>
      </div>

      {staged.length > 0 && <ApprovalInbox />}

      <RuleList rules={rules} onEdit={openEdit} onNew={openNew} />

      {editorOpen && (
        <ModalShell
          title={editing ? t('automation.editRule') : t('automation.newRule')}
          onClose={closeEditor}
          // The form's ~20 fields live inside `RuleEditor`, so the draft's
          // dirtiness isn't visible here; every accidental dismissal is
          // confirmed rather than silently discarding the whole rule.
          confirmClose
        >
          {/* Remount on the edited rule so the form re-initializes from it. */}
          <RuleEditor
            key={editing?.id ?? 'new'}
            editing={editing}
            onDone={closeEditor}
          />
        </ModalShell>
      )}

      <AuditLogView />
    </div>
  );
}

function ApprovalInbox() {
  const { t } = useTranslation();
  const staged = useMeshStore((s) => s.stagedActions);

  return (
    <div className='flex flex-col gap-2 border-t border-(--border) pt-3'>
      <span className='text-xs font-semibold text-(--text)'>
        {t('automation.inbox.title', { count: staged.length })}
      </span>
      <ApprovalInboxList />
    </div>
  );
}

/**
 * The list of staged actions, each awaiting Approve or Deny. Shared by the
 * settings-panel {@link ApprovalInbox} and the header's proposals popup so both
 * render identical rows against the same store.
 */
export function ApprovalInboxList() {
  const { t } = useTranslation();
  const staged = useMeshStore((s) => s.stagedActions);
  const resolve = useMeshStore((s) => s.resolveStagedAction);
  const showToast = useMeshStore((s) => s.showToast);

  return (
    <div className='flex flex-col gap-2'>
      {staged.map((a) => (
        <div
          key={a.id}
          className='flex items-center justify-between gap-2 rounded-md bg-(--surface) px-2.5 py-2'
        >
          <div className='flex min-w-0 flex-col'>
            <span className='text-xs wrap-break-word text-(--text)'>
              {a.summary}
            </span>
            <span className='text-[11px] text-(--text2)'>{a.ruleName}</span>
          </div>
          <div className='flex shrink-0 gap-1.5'>
            <button
              onClick={async () => {
                const outcome = await automationEngine.runApproved(
                  a.tool,
                  a.args,
                  a.ruleId,
                  a.ruleName,
                );
                // A rate-limited transmit was never sent — keep the proposal
                // in the inbox to retry instead of dropping an approved action.
                if (outcome === 'rateLimited') {
                  showToast(t('automation.rateLimitedToast'), 'error');
                  return;
                }
                resolve(a.id);
              }}
              className='rounded-md bg-(--accent-solid) px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-(--accent-hover)'
            >
              {t('automation.inbox.approve')}
            </button>
            <button
              onClick={() => {
                automationEngine.recordDenied(
                  a.tool,
                  a.args,
                  a.ruleId,
                  a.ruleName,
                );
                resolve(a.id);
              }}
              className='rounded-md border border-(--border-control) px-2.5 py-1 text-[11px] text-(--text2) hover:text-(--text)'
            >
              {t('automation.inbox.deny')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RuleList({
  rules,
  onEdit,
  onNew,
}: {
  rules: AutomationRule[];
  onEdit: (rule: AutomationRule) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation();
  const update = useMeshStore((s) => s.updateAutomationRule);
  const remove = useMeshStore((s) => s.removeAutomationRule);

  return (
    <div className='flex flex-col gap-2 border-t border-(--border) pt-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-semibold text-(--text)'>
          {t('automation.rules')}
        </span>
        <button
          onClick={onNew}
          className='flex items-center gap-1 rounded-md bg-(--accent-solid) px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-(--accent-hover)'
        >
          <Plus size={12} />
          {t('automation.newRule')}
        </button>
      </div>
      {rules.length === 0 && (
        <p className='text-[11px] text-(--text2)'>{t('automation.noRules')}</p>
      )}
      {rules.map((r) => (
        <div
          key={r.id}
          className='flex items-center justify-between gap-2 rounded-md bg-(--surface) px-2.5 py-2'
        >
          <div className='flex min-w-0 flex-col'>
            <span className='truncate text-xs font-semibold text-(--text)'>
              {r.name}
            </span>
            <span className='text-[11px] text-(--text2)'>
              {t(`automation.trigger.${r.trigger.on}`)} ·{' '}
              {t(`automation.autonomy.${r.autonomy}`)}
            </span>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <button
              role='switch'
              aria-checked={r.enabled}
              aria-label={t('automation.enableRule')}
              onClick={() => update(r.id, { enabled: !r.enabled })}
              className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
              style={{
                background: r.enabled ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
                  r.enabled ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </button>
            <button
              onClick={() => onEdit(r)}
              className='rounded-md border border-(--border-control) px-2 py-1 text-[11px] text-(--text2) hover:text-(--accent)'
            >
              {t('automation.edit')}
            </button>
            <button
              onClick={() => {
                remove(r.id);
              }}
              className='rounded-md border border-(--border-control) px-2 py-1 text-[11px] text-(--text2) hover:text-(--red)'
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const selectClass =
  'min-w-0 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent)';

// One past the finite max; selecting this stop saves the UNLIMITED_TURNS
// sentinel so the engine runs without a turn cap.
const TURNS_UNLIMITED_POS = MAX_MAX_TURNS + 1;

function clampInt(
  value: number,
  fallback: number,
  lo: number,
  hi: number,
): number {
  const n = Math.floor(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function deriveFields(editing: AutomationRule | null) {
  const fixedArgs: Record<string, unknown> =
    editing?.action.kind === 'fixed' ? editing.action.args : {};
  const target =
    typeof fixedArgs.to === 'string'
      ? fixedArgs.to
      : typeof fixedArgs.pubkeyPrefix === 'string'
        ? fixedArgs.pubkeyPrefix
        : '';
  return {
    name: editing?.name ?? '',
    triggerOn: editing?.trigger.on ?? ('message' as RuleTrigger['on']),
    scope:
      editing?.trigger.on === 'message'
        ? editing.trigger.scope
        : ('any' as 'any' | 'direct' | 'channel'),
    triggerChannels:
      editing?.trigger.on === 'message' ? (editing.trigger.channels ?? []) : [],
    triggerContacts:
      editing?.trigger.on === 'message' ? (editing.trigger.contacts ?? []) : [],
    advTypes:
      editing?.trigger.on === 'advert' ? (editing.trigger.advTypes ?? []) : [],
    cron: editing?.trigger.on === 'schedule' ? editing.trigger.cron : '',
    contains: editing?.condition?.contains ?? '',
    actionKind: editing?.action.kind ?? ('prompt' as 'fixed' | 'prompt'),
    fixedTool:
      editing?.action.kind === 'fixed'
        ? editing.action.tool
        : ('send_channel_message' as ToolName),
    fixedText: typeof fixedArgs.text === 'string' ? fixedArgs.text : '',
    fixedTarget: target,
    fixedChannel:
      fixedArgs.channelIdx !== undefined ? String(fixedArgs.channelIdx) : '',
    fixedFlood: fixedArgs.flood === true,
    system: editing?.action.kind === 'prompt' ? editing.action.system : '',
    allowTools:
      editing?.action.kind === 'prompt'
        ? editing.action.allowTools
        : (['send_direct_message'] as ToolName[]),
    maxTurns:
      editing?.action.kind === 'prompt' && editing.action.maxTurns != null
        ? editing.action.maxTurns === UNLIMITED_TURNS
          ? TURNS_UNLIMITED_POS
          : editing.action.maxTurns
        : DEFAULT_MAX_TURNS,
    maxTokens:
      editing?.action.kind === 'prompt' && editing.action.maxTokens != null
        ? editing.action.maxTokens
        : DEFAULT_MAX_TOKENS,
    autonomy: editing?.autonomy ?? ('approve' as 'approve' | 'auto'),
    cooldownSec: editing?.cooldownSec ?? 0,
  };
}

// The parent remounts this via a `key`, so switching rules re-initializes the
// fields from `editing`.
function RuleEditor({
  editing,
  onDone,
}: {
  editing: AutomationRule | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const addRule = useMeshStore((s) => s.addAutomationRule);
  const updateRule = useMeshStore((s) => s.updateAutomationRule);
  const contacts = useMeshStore((s) => s.contacts);
  const channels = useMeshStore((s) => s.channels);
  const adverts = useMeshStore((s) => s.adverts);

  const init = deriveFields(editing);
  const [name, setName] = useState(init.name);
  const [triggerOn, setTriggerOn] = useState<RuleTrigger['on']>(init.triggerOn);
  const [scope, setScope] = useState<'any' | 'direct' | 'channel'>(init.scope);
  const [triggerChannels, setTriggerChannels] = useState<number[]>(
    init.triggerChannels,
  );
  const [triggerContacts, setTriggerContacts] = useState<string[]>(
    init.triggerContacts,
  );
  const [contactQuery, setContactQuery] = useState('');
  const [advTypes, setAdvTypes] = useState<number[]>(init.advTypes);
  const [cron, setCron] = useState(init.cron);
  const [contains, setContains] = useState(init.contains);
  const [actionKind, setActionKind] = useState<'fixed' | 'prompt'>(
    init.actionKind,
  );
  const [fixedTool, setFixedTool] = useState<ToolName>(init.fixedTool);
  const [fixedText, setFixedText] = useState(init.fixedText);
  const [fixedTarget, setFixedTarget] = useState(init.fixedTarget);
  const [fixedChannel, setFixedChannel] = useState(init.fixedChannel);
  const [fixedFlood, setFixedFlood] = useState(init.fixedFlood);
  const [system, setSystem] = useState(init.system);
  const [allowTools, setAllowTools] = useState<ToolName[]>(init.allowTools);
  const [maxTurns, setMaxTurns] = useState(init.maxTurns);
  const [maxTokens, setMaxTokens] = useState(init.maxTokens);
  const [autonomy, setAutonomy] = useState<'approve' | 'auto'>(init.autonomy);
  const [cooldownSec, setCooldownSec] = useState(init.cooldownSec);

  const toggleTool = (tool: ToolName) => {
    setAllowTools((prev) =>
      prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool],
    );
  };

  // Toggles an advert node-type filter: a filter is on when all of its advType
  // values are selected, so clicking removes them all, else adds the missing.
  const toggleAdvType = (types: number[]) => {
    setAdvTypes((prev) =>
      types.every((t) => prev.includes(t))
        ? prev.filter((t) => !types.includes(t))
        : [...prev, ...types.filter((t) => !prev.includes(t))],
    );
  };

  // Toggles a channel in the channel-message filter (channels are few, so all
  // are shown as inline chips).
  const toggleChannel = (idx: number) => {
    setTriggerChannels((prev) =>
      prev.includes(idx) ? prev.filter((c) => c !== idx) : [...prev, idx],
    );
  };

  // Toggles a contact in the direct-message filter, keyed by pubkeyPrefix.
  const toggleContact = (prefix: string) => {
    setTriggerContacts((prev) =>
      prev.includes(prefix)
        ? prev.filter((c) => c !== prefix)
        : [...prev, prefix],
    );
  };

  // Tools whose target is a saved contact, driving which picker the fixed
  // editor shows and which id the built args carry.
  const contactTools: ToolName[] = [
    'send_direct_message',
    'remove_contact',
    'toggle_favorite',
    'reset_contact_path',
  ];
  const needsContact = contactTools.includes(fixedTool);
  const needsChannel = fixedTool === 'send_channel_message';
  const needsAdvert = fixedTool === 'add_contact';
  const needsText =
    fixedTool === 'send_direct_message' || fixedTool === 'send_channel_message';

  const fixedArgs = (): Record<string, unknown> => {
    switch (fixedTool) {
      case 'send_direct_message':
        return { to: fixedTarget, text: fixedText.trim() };
      case 'send_channel_message':
        return { channelIdx: Number(fixedChannel), text: fixedText.trim() };
      case 'advertise':
        return { flood: fixedFlood };
      case 'remove_contact':
      case 'toggle_favorite':
      case 'reset_contact_path':
        return { pubkeyPrefix: fixedTarget };
      case 'add_contact':
        return { pubkeyPrefix: fixedTarget };
      default:
        return {};
    }
  };

  const fixedValid =
    ((!needsContact && !needsAdvert) || fixedTarget !== '') &&
    (!needsChannel || fixedChannel !== '') &&
    (!needsText || fixedText.trim() !== '');

  const canSave =
    name.trim() !== '' &&
    (triggerOn !== 'schedule' || isValidCron(cron)) &&
    (actionKind === 'fixed'
      ? fixedValid
      : system.trim() !== '' && allowTools.length > 0);

  const save = () => {
    if (!canSave) return;
    const trigger: RuleTrigger =
      triggerOn === 'message'
        ? {
            on: 'message',
            scope,
            channels:
              scope === 'channel' && triggerChannels.length
                ? triggerChannels
                : undefined,
            contacts:
              scope === 'direct' && triggerContacts.length
                ? triggerContacts
                : undefined,
          }
        : triggerOn === 'advert'
          ? { on: 'advert', advTypes: advTypes.length ? advTypes : undefined }
          : triggerOn === 'ack'
            ? { on: 'ack' }
            : triggerOn === 'schedule'
              ? { on: 'schedule', cron: cron.trim() }
              : { on: 'connection' };

    const action: RuleAction =
      actionKind === 'fixed'
        ? { kind: 'fixed', tool: fixedTool, args: fixedArgs() }
        : {
            kind: 'prompt',
            system: system.trim(),
            allowTools,
            maxTurns:
              maxTurns >= TURNS_UNLIMITED_POS
                ? UNLIMITED_TURNS
                : clampInt(
                    maxTurns,
                    DEFAULT_MAX_TURNS,
                    MIN_MAX_TURNS,
                    MAX_MAX_TURNS,
                  ),
            maxTokens: clampInt(
              maxTokens,
              DEFAULT_MAX_TOKENS,
              MIN_MAX_TOKENS,
              MAX_MAX_TOKENS,
            ),
          };

    const allowlist: ToolName[] =
      actionKind === 'fixed' ? [fixedTool] : allowTools;

    const condition =
      triggerOn === 'message' && contains.trim()
        ? { contains: contains.trim() }
        : undefined;

    const cooldown =
      cooldownSec > 0
        ? clampInt(cooldownSec, 0, 0, MAX_COOLDOWN_SEC)
        : undefined;

    if (editing) {
      // Preserve the rule's id and enabled state; overwrite everything else.
      updateRule(editing.id, {
        name: name.trim(),
        trigger,
        condition,
        action,
        autonomy,
        allowlist,
        cooldownSec: cooldown,
      });
      onDone();
      return;
    }

    const rule: AutomationRule = {
      id: crypto.randomUUID(),
      enabled: true,
      name: name.trim(),
      trigger,
      condition,
      action,
      autonomy,
      allowlist,
      cooldownSec: cooldown,
    };
    addRule(rule);
    onDone();
  };

  return (
    <div className='flex flex-col gap-2.5'>
      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-(--text2)'>{t('automation.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('automation.namePlaceholder')}
          className={selectClass}
        />
      </label>

      <div className='flex gap-2'>
        <label className='flex flex-1 flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('automation.when')}</span>
          <select
            value={triggerOn}
            onChange={(e) => setTriggerOn(e.target.value as RuleTrigger['on'])}
            className={selectClass}
          >
            {TRIGGER_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`automation.trigger.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {triggerOn === 'message' && (
          <label className='flex flex-1 flex-col gap-1 text-xs'>
            <span className='text-(--text2)'>{t('automation.scope')}</span>
            <select
              value={scope}
              onChange={(e) =>
                setScope(e.target.value as 'any' | 'direct' | 'channel')
              }
              className={selectClass}
            >
              <option value='any'>{t('automation.scopeAny')}</option>
              <option value='direct'>{t('automation.scopeDirect')}</option>
              <option value='channel'>{t('automation.scopeChannel')}</option>
            </select>
          </label>
        )}
      </div>

      {triggerOn === 'message' && scope === 'channel' && (
        <div className='flex flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>
            {t('automation.triggerChannels')}
          </span>
          {Object.keys(channels).length === 0 ? (
            <span className='text-[11px] text-(--text2)'>
              {t('automation.noChannels')}
            </span>
          ) : (
            <div className='flex flex-wrap gap-1.5'>
              {Object.values(channels).map((ch) => {
                const on = triggerChannels.includes(ch.idx);
                return (
                  <button
                    key={ch.idx}
                    type='button'
                    onClick={() => toggleChannel(ch.idx)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      on
                        ? 'border-(--accent) bg-(--accent-solid) text-white'
                        : 'border-(--border-control) text-(--text2) hover:text-(--text)'
                    }`}
                  >
                    {ch.name || t('common.channelName', { index: ch.idx })}
                  </button>
                );
              })}
            </div>
          )}
          <span className='text-[11px] text-(--text2)'>
            {t('automation.triggerChannelsHint')}
          </span>
        </div>
      )}

      {triggerOn === 'message' && scope === 'direct' && (
        <div className='flex flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>
            {t('automation.triggerContacts')}
          </span>
          {triggerContacts.length > 0 && (
            <div className='flex flex-wrap gap-1.5'>
              {triggerContacts.map((prefix) => {
                const c = contacts[prefix];
                return (
                  <button
                    key={prefix}
                    type='button'
                    onClick={() => toggleContact(prefix)}
                    className='flex items-center gap-1 rounded-md border border-(--accent) bg-(--accent-solid) px-2 py-1 text-[11px] text-white'
                  >
                    <span>{c?.name || prefix}</span>
                    <X size={11} />
                  </button>
                );
              })}
            </div>
          )}
          <input
            value={contactQuery}
            onChange={(e) => setContactQuery(e.target.value)}
            placeholder={t('automation.searchContacts')}
            className={selectClass}
          />
          {(() => {
            const q = contactQuery.trim().toLowerCase();
            const matches = Object.values(contacts).filter(
              (c) =>
                q === '' ||
                c.name.toLowerCase().includes(q) ||
                c.pubkeyPrefix.toLowerCase().includes(q),
            );
            if (Object.keys(contacts).length === 0) {
              return (
                <span className='text-[11px] text-(--text2)'>
                  {t('automation.noContacts')}
                </span>
              );
            }
            return (
              <div className='flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-(--border-control) p-1'>
                {matches.length === 0 ? (
                  <span className='px-1.5 py-1 text-[11px] text-(--text2)'>
                    {t('automation.noContactMatches')}
                  </span>
                ) : (
                  matches.map((c) => {
                    const on = triggerContacts.includes(c.pubkeyPrefix);
                    return (
                      <button
                        key={c.pubkeyPrefix}
                        type='button'
                        onClick={() => toggleContact(c.pubkeyPrefix)}
                        className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                          on
                            ? 'bg-(--accent-solid) text-white'
                            : 'text-(--text) hover:bg-(--surface)'
                        }`}
                      >
                        <span className='truncate'>
                          {c.name || c.pubkeyPrefix}
                        </span>
                        {on && <Check size={12} className='shrink-0' />}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })()}
          <span className='text-[11px] text-(--text2)'>
            {t('automation.triggerContactsHint')}
          </span>
        </div>
      )}

      {triggerOn === 'message' && (
        <label className='flex flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('automation.contains')}</span>
          <input
            value={contains}
            onChange={(e) => setContains(e.target.value)}
            placeholder={t('automation.containsPlaceholder')}
            className={selectClass}
          />
          <span className='text-[11px] text-(--text2)'>
            {t('automation.containsHint')}{' '}
            <a
              href='https://regex101.com'
              target='_blank'
              rel='noreferrer'
              className='text-(--accent) hover:underline'
            >
              regex101.com
            </a>
          </span>
        </label>
      )}

      {triggerOn === 'advert' && (
        <div className='flex flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('automation.advTypes')}</span>
          <div className='flex flex-wrap gap-1.5'>
            {ADV_TYPE_FILTERS.map(({ key, types }) => {
              const on = types.every((type) => advTypes.includes(type));
              return (
                <button
                  key={key}
                  type='button'
                  onClick={() => toggleAdvType(types)}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    on
                      ? 'border-(--accent) bg-(--accent-solid) text-white'
                      : 'border-(--border-control) text-(--text2) hover:text-(--text)'
                  }`}
                >
                  {t(`automation.advType.${key}`)}
                </button>
              );
            })}
          </div>
          <span className='text-[11px] text-(--text2)'>
            {t('automation.advTypesHint')}
          </span>
        </div>
      )}

      {triggerOn === 'schedule' && (
        <label className='flex flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('automation.cron')}</span>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder={t('automation.cronPlaceholder')}
            className={`${selectClass} font-mono ${
              cron.trim() !== '' && !isValidCron(cron) ? 'border-(--red)' : ''
            }`}
          />
          <span className='text-[11px] text-(--text2)'>
            {t('automation.cronHint')}{' '}
            <a
              href='https://crontab.guru'
              target='_blank'
              rel='noreferrer'
              className='text-(--accent) hover:underline'
            >
              crontab.guru
            </a>
          </span>
          {cron.trim() !== '' && !isValidCron(cron) && (
            <span className='text-[11px] text-(--red)'>
              {t('automation.cronInvalid')}
            </span>
          )}
        </label>
      )}

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-(--text2)'>{t('automation.do')}</span>
        <select
          value={actionKind}
          onChange={(e) => setActionKind(e.target.value as 'fixed' | 'prompt')}
          className={selectClass}
        >
          <option value='prompt'>{t('automation.actionPrompt')}</option>
          <option value='fixed'>{t('automation.actionFixed')}</option>
        </select>
      </label>

      {actionKind === 'fixed' ? (
        <>
          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-(--text2)'>{t('automation.tool')}</span>
            <select
              value={fixedTool}
              onChange={(e) => setFixedTool(e.target.value as ToolName)}
              className={selectClass}
            >
              {TOOL_NAMES.map((tool) => (
                <option key={tool} value={tool}>
                  {tool}
                </option>
              ))}
            </select>
          </label>
          {needsContact && (
            <label className='flex flex-col gap-1 text-xs'>
              <span className='text-(--text2)'>{t('automation.contact')}</span>
              <select
                value={fixedTarget}
                onChange={(e) => setFixedTarget(e.target.value)}
                className={selectClass}
              >
                <option value=''>{t('automation.pick')}</option>
                {Object.values(contacts).map((c) => (
                  <option key={c.pubkeyPrefix} value={c.pubkeyPrefix}>
                    {c.name || c.pubkeyPrefix}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsAdvert && (
            <label className='flex flex-col gap-1 text-xs'>
              <span className='text-(--text2)'>{t('automation.node')}</span>
              <select
                value={fixedTarget}
                onChange={(e) => setFixedTarget(e.target.value)}
                className={selectClass}
              >
                <option value=''>{t('automation.pick')}</option>
                {Object.values(adverts).map((a) => (
                  <option key={a.pubkeyPrefix} value={a.pubkeyPrefix}>
                    {a.name || a.pubkeyPrefix}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsChannel && (
            <label className='flex flex-col gap-1 text-xs'>
              <span className='text-(--text2)'>{t('automation.channel')}</span>
              <select
                value={fixedChannel}
                onChange={(e) => setFixedChannel(e.target.value)}
                className={selectClass}
              >
                <option value=''>{t('automation.pick')}</option>
                {Object.values(channels).map((ch) => (
                  <option key={ch.idx} value={ch.idx}>
                    {ch.name || t('common.channelName', { index: ch.idx })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {needsText && (
            <label className='flex flex-col gap-1 text-xs'>
              <span className='text-(--text2)'>{t('automation.message')}</span>
              <input
                value={fixedText}
                onChange={(e) => setFixedText(e.target.value)}
                placeholder={t('automation.messagePlaceholder')}
                className={selectClass}
              />
            </label>
          )}
          {fixedTool === 'advertise' && (
            <button
              role='switch'
              aria-checked={fixedFlood}
              onClick={() => setFixedFlood((v) => !v)}
              className='flex items-center justify-between gap-2 text-left text-xs text-(--text)'
            >
              <span>{t('automation.flood')}</span>
              <span
                className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
                style={{
                  background: fixedFlood ? 'var(--accent)' : 'var(--border)',
                }}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
                    fixedFlood ? 'left-3.5' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          )}
        </>
      ) : (
        <>
          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-(--text2)'>{t('automation.system')}</span>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={3}
              placeholder={t('automation.systemPlaceholder')}
              className={`${selectClass} resize-y`}
            />
          </label>
          <div className='flex flex-col gap-1 text-xs'>
            <span className='text-(--text2)'>{t('automation.allowTools')}</span>
            <div className='flex flex-wrap gap-1.5'>
              {TOOL_NAMES.map((tool) => {
                const on = allowTools.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      on
                        ? 'border-(--accent) bg-(--accent-solid) text-white'
                        : 'border-(--border-control) text-(--text2) hover:text-(--text)'
                    }`}
                    title={toolClass(tool)}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>
          <div className='flex flex-col gap-2.5'>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='flex items-center justify-between text-(--text2)'>
                <span>{t('automation.maxTurns')}</span>
                <span className='font-semibold text-(--text)'>
                  {maxTurns >= TURNS_UNLIMITED_POS
                    ? t('automation.unlimited')
                    : maxTurns}
                </span>
              </span>
              <input
                type='range'
                min={MIN_MAX_TURNS}
                max={TURNS_UNLIMITED_POS}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                className='w-full accent-(--accent)'
              />
              <span className='text-[11px] text-(--text2)'>
                {t('automation.maxTurnsHint')}
              </span>
            </label>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='flex items-center justify-between text-(--text2)'>
                <span>{t('automation.maxTokens')}</span>
                <span className='font-semibold text-(--text)'>{maxTokens}</span>
              </span>
              <input
                type='range'
                min={MIN_MAX_TOKENS}
                max={MAX_MAX_TOKENS}
                step={256}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className='w-full accent-(--accent)'
              />
              <span className='text-[11px] text-(--text2)'>
                {t('automation.maxTokensHint', {
                  min: MIN_MAX_TOKENS,
                  max: MAX_MAX_TOKENS,
                })}
              </span>
            </label>
          </div>
        </>
      )}

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-(--text2)'>{t('automation.autonomyLabel')}</span>
        <select
          value={autonomy}
          onChange={(e) => setAutonomy(e.target.value as 'approve' | 'auto')}
          className={selectClass}
        >
          <option value='approve'>{t('automation.autonomy.approve')}</option>
          <option value='auto'>{t('automation.autonomy.auto')}</option>
        </select>
      </label>
      {autonomy === 'auto' && (
        <p className='rounded-md border border-(--border) px-2.5 py-2 text-[11px] text-(--text2)'>
          {t('automation.autoWarning')}
        </p>
      )}

      <label className='flex flex-col gap-1 text-xs'>
        <span className='flex items-center justify-between text-(--text2)'>
          <span>{t('automation.cooldown')}</span>
          <span className='font-semibold text-(--text)'>
            {cooldownSec >= 60
              ? t('automation.cooldownValue', {
                  minutes: Math.floor(cooldownSec / 60),
                  seconds: cooldownSec % 60,
                })
              : t('automation.cooldownValueSeconds', { seconds: cooldownSec })}
          </span>
        </span>
        <input
          type='range'
          min={0}
          max={MAX_COOLDOWN_SEC}
          step={5}
          value={cooldownSec}
          onChange={(e) => setCooldownSec(Number(e.target.value))}
          className='w-full accent-(--accent)'
        />
        <span className='text-[11px] text-(--text2)'>
          {t('automation.cooldownHint')}
        </span>
      </label>

      <div className='flex items-center justify-end gap-2'>
        <button
          onClick={onDone}
          className='rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text2) hover:text-(--text)'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          className='rounded-md bg-(--accent-solid) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent-solid)'
        >
          {editing ? t('automation.saveRule') : t('automation.addRule')}
        </button>
      </div>
    </div>
  );
}

function AuditLogView() {
  const { t } = useTranslation();
  const log = useMeshStore((s) => s.auditLog);
  const clear = useMeshStore((s) => s.clearAuditLog);

  return (
    <div className='flex flex-col gap-2 border-t border-(--border) pt-3'>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-semibold text-(--text)'>
          {t('automation.audit.title')}
        </span>
        {log.length > 0 && (
          <button
            onClick={() => clear()}
            className='text-[11px] text-(--text2) hover:text-(--text)'
          >
            {t('automation.audit.clear')}
          </button>
        )}
      </div>
      {log.length === 0 ? (
        <p className='text-[11px] text-(--text2)'>
          {t('automation.audit.empty')}
        </p>
      ) : (
        <div className='flex max-h-64 flex-col gap-1 overflow-y-auto'>
          {log.map((e) => (
            <div
              key={e.id}
              className='flex flex-col rounded-md bg-(--surface) px-2.5 py-1.5 text-[11px]'
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='truncate font-semibold text-(--text)'>
                  {e.ruleName}
                </span>
                <span className='shrink-0 text-(--text2)'>
                  {t(`automation.outcome.${e.outcome}`)}
                </span>
              </div>
              <span className='truncate text-(--text2)'>
                {e.event}
                {e.tool ? ` · ${e.tool}` : ''}
                {e.detail ? ` · ${e.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
