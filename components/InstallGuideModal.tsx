// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { installApp, installBrowser } from '@/lib/pwa/install';
import { ModalShell } from './ModalShell';

const BENEFITS = ['window', 'offline', 'data', 'updates'] as const;

const STEP_KEY = {
  chrome: 'install.guide.chromeStep',
  edge: 'install.guide.edgeStep',
} as const;

/**
 * The "Install as a desktop app" guide: what installing gives, the steps for
 * the detected browser (or a pointer to Chrome and Edge where the app can't be
 * installed), and how to uninstall. Keeps no state of its own; offers the
 * browser's own dialog too while a captured prompt is still usable. Mounted
 * only while `installGuideOpen` is set.
 */
export function InstallGuideModal() {
  const { t } = useTranslation();
  const setInstallGuideOpen = useMeshStore((s) => s.setInstallGuideOpen);
  const canPrompt = useMeshStore((s) => s.installPrompt !== null);
  const browser = installBrowser();
  const close = () => setInstallGuideOpen(false);

  return (
    <ModalShell title={t('install.guide.title')} onClose={close}>
      <div className='flex flex-col gap-5 text-sm'>
        <section>
          <h3 className='mb-1.5 font-semibold'>
            {t('install.guide.benefitsHeading')}
          </h3>
          <ul className='list-disc space-y-1 pl-5 text-text2'>
            {BENEFITS.map((b) => (
              <li key={b}>{t(`install.guide.benefit.${b}`)}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className='mb-1.5 font-semibold'>
            {t('install.guide.stepsHeading')}
          </h3>
          {browser === 'other' ? (
            <p className='text-text2'>{t('install.guide.unsupported')}</p>
          ) : (
            <ol className='list-decimal space-y-1 pl-5 text-text2'>
              <li>{t(STEP_KEY[browser])}</li>
              <li>{t('install.guide.confirmStep')}</li>
            </ol>
          )}
        </section>
        <section>
          <h3 className='mb-1.5 font-semibold'>
            {t('install.guide.uninstallHeading')}
          </h3>
          <p className='text-text2'>{t('install.guide.uninstall')}</p>
        </section>
        {canPrompt && (
          <button
            type='button'
            onClick={() => {
              close();
              void installApp();
            }}
            className='self-end rounded-md bg-accent-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover'
          >
            {t('install.guide.installNow')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
