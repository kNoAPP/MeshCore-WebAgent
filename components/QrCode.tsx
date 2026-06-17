// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/**
 * Renders `value` as a QR code onto a canvas. Drawn black-on-white inside a
 * white card regardless of theme so it stays scannable in dark mode.
 *
 * @param size - the canvas edge length in pixels (default 200).
 */
export function QrCode({
  value,
  size = 200,
}: {
  value: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {
      // QR generation failing (e.g. unsupported canvas) is non-fatal; the
      // public key text below remains available as a fallback.
    });
  }, [value, size]);

  return (
    <div className='rounded-lg bg-white p-3'>
      <canvas ref={ref} width={size} height={size} aria-hidden='true' />
    </div>
  );
}
