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

/**
 * Centered modal overlay with a title bar and close button. Clicking the
 * backdrop (outside the card) calls `onClose`.
 *
 * @param widthClass - Tailwind width utility for the card; defaults to `w-120`.
 */
export function ModalShell({
  title,
  onClose,
  children,
  widthClass = 'w-120',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center'
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`max-h-[85vh] ${widthClass} max-w-[95vw] overflow-y-auto rounded-[10px] border p-7`}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className='mb-5 flex items-center justify-between'>
          <h2 className='text-base font-bold'>{title}</h2>
          <button
            onClick={onClose}
            className='text-lg leading-none text-(--text2) hover:text-(--text)'
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
