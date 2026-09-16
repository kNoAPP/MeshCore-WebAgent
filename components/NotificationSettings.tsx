// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import {
  notifyPermission,
  playNotifyTone,
  requestNotifyPermission,
  showNotification,
  subscribeNotifyPermission,
  type NotifyPermission,
} from '@/lib/notify';
import { NOTIFY_MODES, type NotifyMode } from '@/lib/notify/pref';
import { Select } from './Select';
import { SwitchTrack } from './Switch';
import { SaveStatusChip } from './SaveStatus';

const PERMISSION_LABEL = {
  granted: 'settings.notify.permissionGranted',
  denied: 'settings.notify.permissionDenied',
  default: 'settings.notify.permissionDefault',
  unsupported: 'settings.notify.permissionUnsupported',
} as const satisfies Record<NotifyPermission, string>;

// The static export renders this card ahead of time, where there is no
// `Notification` at all; reporting `unsupported` until hydration keeps the
// first client paint identical to the server HTML.
function serverPermission(): NotifyPermission {
  return 'unsupported';
}

/**
 * The Notifications settings card body: scope, sound, and the browser
 * permission state with an opt-in prompt and a test notification. Rendered
 * inside the Settings page's Notifications card.
 *
 * @remarks
 * Permission is only ever requested from a click here — never on load — and
 * the scope preference is per-radio, persisted in the encrypted preferences
 * blob because a notification body carries message content.
 */
export function NotificationSettingsBody() {
  const { t } = useTranslation();
  const pref = useMeshStore((s) => s.notifyPref);
  const setNotifyPref = useMeshStore((s) => s.setNotifyPref);
  const permission = useSyncExternalStore(
    subscribeNotifyPermission,
    notifyPermission,
    serverPermission,
  );

  const blocked = permission === 'denied' || permission === 'unsupported';

  const pickMode = (mode: NotifyMode) => {
    setNotifyPref({ ...pref, mode });
    // Turning notifications on *is* the explicit opt-in, so this click is the
    // gesture the permission prompt needs.
    if (mode !== 'off' && permission === 'default') {
      void requestNotifyPermission();
    }
  };

  const test = () => {
    showNotification({
      title: t('notify.testTitle'),
      body: t('notify.testBody'),
      tag: 'test',
    });
    if (pref.sound) playNotifyTone();
  };

  return (
    <>
      <p className='mb-3 text-xs text-text2'>{t('settings.notify.hint')}</p>
      <div className='flex items-center justify-between gap-3 border-b border-border py-1.5 text-xs'>
        <span className='shrink-0 text-text2'>{t('settings.notify.mode')}</span>
        <span className='flex items-center gap-2'>
          <Select
            value={pref.mode}
            onChange={pickMode}
            ariaLabel={t('settings.notify.mode')}
            disabled={blocked}
            options={NOTIFY_MODES.map((mode) => ({
              value: mode,
              label: t(`settings.notify.mode_${mode}`),
            }))}
            className='cursor-pointer transition-colors hover:border-accent'
          />
          <SaveStatusChip />
        </span>
      </div>
      <button
        role='switch'
        aria-checked={pref.sound}
        disabled={blocked || pref.mode === 'off'}
        onClick={() => setNotifyPref({ ...pref, sound: !pref.sound })}
        className='flex w-full items-center justify-between gap-3 border-b border-border py-1.5 text-left text-xs text-text disabled:cursor-not-allowed disabled:opacity-50'
      >
        <span className='text-text2'>{t('settings.notify.sound')}</span>
        <span className='flex items-center gap-2'>
          <SwitchTrack checked={pref.sound} />
          <SaveStatusChip />
        </span>
      </button>
      <div className='flex items-center justify-between gap-3 py-1.5 text-xs'>
        <span className='shrink-0 text-text2'>
          {t('settings.notify.permission')}
        </span>
        <span className='flex items-center gap-2'>
          <span className='font-semibold'>
            {t(PERMISSION_LABEL[permission])}
          </span>
          {permission === 'default' && (
            <button
              onClick={() => void requestNotifyPermission()}
              className='rounded-md border border-border-control px-2.5 py-1 text-xs text-text2 hover:text-text'
            >
              {t('settings.notify.allow')}
            </button>
          )}
          {permission === 'granted' && (
            <button
              onClick={test}
              className='rounded-md border border-border-control px-2.5 py-1 text-xs text-text2 hover:text-text'
            >
              {t('settings.notify.test')}
            </button>
          )}
        </span>
      </div>
      {blocked && (
        <p className='pb-1 text-xs text-text2'>
          {t(
            permission === 'denied'
              ? 'settings.notify.deniedHint'
              : 'settings.notify.unsupportedHint',
          )}
        </p>
      )}
    </>
  );
}
