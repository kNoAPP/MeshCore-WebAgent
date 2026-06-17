// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

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
    });
  }, [value, size]);

  return (
    <div className='rounded-lg bg-white p-3'>
      <canvas ref={ref} width={size} height={size} />
    </div>
  );
}
