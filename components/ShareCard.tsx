// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { Radio } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { QrCode } from './QrCode';

/**
 * The complete share UI for handing off a node as a `meshcore://contact/add`
 * link: a scannable QR, a bold title, a scan hint, the public key with a copy
 * button, and a zero-hop advert action. Shared verbatim between sharing another
 * contact ({@link ManagePanel}) and your own node ({@link SettingsPage}) so the
 * two screens are identical; each caller only supplies the strings, values, and
 * advert handler.
 *
 * @param qrValue - the string encoded into the QR (the share URI).
 * @param title - the bold heading above the scan hint (icon + node name).
 * @param scanHint - the muted line prompting the viewer to scan the QR.
 * @param pubkeyLabel - the caption above the public-key copy row.
 * @param pubkey - the full public key, shown in the copy row and copied on
 * click.
 * @param advertLabel - the zero-hop advert button's label.
 * @param advertHint - the muted explanation shown beneath the advert buttons.
 * @param advertDisabled - disables the advert button (e.g. for repeaters).
 * @param onAdvert - invoked by the zero-hop advert button.
 * @param floodLabel - the flood advert button's label; required when
 * {@link onFloodAdvert} is set.
 * @param floodDisabled - disables the flood advert button.
 * @param onFloodAdvert - when set, renders a second (flood) advert button
 * beside the zero-hop one; only self-share uses it.
 */
export function ShareCard({
  qrValue,
  title,
  scanHint,
  pubkeyLabel,
  pubkey,
  advertLabel,
  advertHint,
  advertDisabled,
  onAdvert,
  floodLabel,
  floodDisabled,
  onFloodAdvert,
}: {
  qrValue: string;
  title: string;
  scanHint: string;
  pubkeyLabel: string;
  pubkey: string;
  advertLabel: string;
  advertHint: string;
  advertDisabled?: boolean;
  onAdvert: () => void;
} & (
  | {
      onFloodAdvert?: undefined;
      floodLabel?: undefined;
      floodDisabled?: undefined;
    }
  | { onFloodAdvert: () => void; floodLabel: string; floodDisabled?: boolean }
)) {
  return (
    <div>
      <div className='flex flex-col items-center gap-2'>
        <QrCode value={qrValue} size={180} />
        <span className='text-base font-bold'>{title}</span>
        <span className='text-xs text-(--text2)'>{scanHint}</span>
      </div>

      <div className='mt-5'>
        <span className='text-xs text-(--text2)'>{pubkeyLabel}</span>
        <div className='mt-1 flex items-center gap-3 rounded-md bg-(--surface2) px-3 py-2'>
          <span className='flex-1 font-mono text-xs break-all'>{pubkey}</span>
          <CopyButton value={pubkey} />
        </div>
      </div>

      <div className='mt-6 border-t border-(--border) pt-4'>
        <div className='flex gap-2'>
          <button
            onClick={onAdvert}
            disabled={advertDisabled}
            className='flex flex-1 items-center justify-center gap-2 rounded-md bg-(--accent-solid) px-3 py-2 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent-solid)'
          >
            <Radio size={16} />
            {advertLabel}
          </button>
          {onFloodAdvert && (
            <button
              onClick={onFloodAdvert}
              disabled={floodDisabled}
              className='flex flex-1 items-center justify-center gap-2 rounded-md border border-(--border-control) px-3 py-2 text-sm text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-(--text2)'
            >
              <Radio size={16} />
              {floodLabel}
            </button>
          )}
        </div>
        <p className='mt-2 text-center text-xs text-(--text2)'>{advertHint}</p>
      </div>
    </div>
  );
}
