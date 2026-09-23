// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BIP39_ENGLISH } from '@/lib/identity/wordlist';
import type { MnemonicLength } from '@/lib/identity/seed';

const LENGTHS: MnemonicLength[] = [12, 15, 18, 21, 24];
const WORDS = new Set(BIP39_ENGLISH);

function boxesOf(phrase: string, length: number): string[] {
  const words = phrase ? phrase.split(' ') : [];
  return Array.from({ length }, (_, i) => words[i] ?? '');
}

function isWordPrefix(word: string): boolean {
  return BIP39_ENGLISH.some((w) => w.startsWith(word));
}

/**
 * The words of a {@link PhraseInput} phrase that are not in the BIP-39
 * English list, with their zero-based box positions.
 */
export function unknownWords(
  phrase: string,
): { index: number; word: string }[] {
  return phrase
    .normalize('NFKD')
    .toLowerCase()
    .split(' ')
    .flatMap((word, index) =>
      word && !WORDS.has(word) ? [{ index, word }] : [],
    );
}

/**
 * A recovery phrase typed one word per numbered box, laid out like the phrase
 * the create wizard shows, so each word on paper has an obvious place.
 *
 * @remarks Space or Enter moves to the next box and Backspace in an empty box
 * to the previous one. Pasting several words spreads them from the box pasted
 * into; a whole phrase too long to fit there fills from the first box and
 * sets the length.
 *
 * @param value - the words joined by single spaces, as {@link unknownWords}
 * and the seed functions read it.
 */
export function PhraseInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const [length, setLength] = useState<MnemonicLength>(() => {
    const typed = value ? value.split(' ').length : 0;
    return LENGTHS.find((n) => n >= typed) ?? 24;
  });
  const [focused, setFocused] = useState<number | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // A box to focus once a spread that changed the box count has rendered.
  const pendingFocus = useRef<number | null>(null);
  const boxes = boxesOf(value, length);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    inputs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  // The phrase travels as its boxes joined by single spaces, so an empty box
  // between filled ones survives as an empty word. Trailing empty boxes are
  // dropped, so a phrase nothing was typed into is ''.
  const emit = (next: string[]) => onChange(next.join(' ').trimEnd());

  const focusBox = (i: number) => {
    const el = inputs.current[i];
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  };

  const spread = (at: number, text: string) => {
    const words = text.toLowerCase().trim().split(/\s+/).filter(Boolean);
    // Words that fit from this box land here, so a long phrase can go in
    // piece by piece; a whole phrase that does not fit refills from box 1.
    const fits = at + words.length <= length;
    const whole = fits ? undefined : LENGTHS.find((n) => n === words.length);
    const start = whole ? 0 : at;
    const nextLength =
      whole ??
      LENGTHS.find((n) => n >= Math.max(length, start + words.length)) ??
      24;
    const next = boxesOf(value, nextLength);
    words.forEach((word, i) => {
      if (start + i < nextLength) next[start + i] = word;
    });
    const target = Math.min(start + words.length, nextLength - 1);
    emit(next);
    // An unchanged spread, such as a space typed after a word, renders
    // nothing, so a deferred focus would wait for some later render.
    if (nextLength === length) {
      focusBox(target);
    } else {
      setLength(nextLength);
      pendingFocus.current = target;
    }
  };

  const flagged = boxes.flatMap((word, index) => {
    const w = word.normalize('NFKD');
    const typing = index === focused && isWordPrefix(w);
    return w && !WORDS.has(w) && !typing ? [{ index, word }] : [];
  });

  return (
    <div role='group' aria-labelledby={labelId}>
      <div className='mb-1 flex items-center justify-between gap-2'>
        <span id={labelId} className='text-xs text-text2'>
          {label}
        </span>
        <select
          value={length}
          disabled={disabled}
          aria-label={t('settings.restore.phraseLength')}
          onChange={(e) => {
            const n = Number(e.target.value) as MnemonicLength;
            setLength(n);
            emit(boxesOf(value, n));
          }}
          className='rounded-md border border-border-control bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-accent-solid disabled:cursor-not-allowed disabled:opacity-50'
        >
          {LENGTHS.map((n) => (
            <option key={n} value={n}>
              {t('settings.restore.wordCount', { count: n })}
            </option>
          ))}
        </select>
      </div>
      <ol className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        {boxes.map((word, i) => {
          const bad = flagged.some((f) => f.index === i);
          return (
            <li
              key={i}
              className={`field-group relative flex items-center overflow-hidden rounded-md border bg-surface2 ${
                bad
                  ? 'border-red'
                  : 'border-border-control focus-within:border-accent-solid'
              }`}
            >
              <span
                aria-hidden
                className='pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center border-r border-border-control text-xs text-text2 tabular-nums'
              >
                {i + 1}
              </span>
              {/* No spellcheck or autocomplete: either would hand the words
                  to a browser service, or keep them in its suggestion
                  history. */}
              <input
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={word}
                disabled={disabled}
                aria-label={t('settings.recovery.confirmWord', { n: i + 1 })}
                aria-invalid={bad}
                autoComplete='off'
                autoCapitalize='off'
                autoCorrect='off'
                spellCheck={false}
                onFocus={() => setFocused(i)}
                onBlur={() => setFocused(null)}
                onKeyDown={(e) => {
                  const last = i === length - 1;
                  if (e.key === ' ' || (e.key === 'Enter' && !last)) {
                    e.preventDefault();
                    if (!last) focusBox(i + 1);
                  } else if (e.key === 'Backspace' && !word && i > 0) {
                    e.preventDefault();
                    focusBox(i - 1);
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (text.trim().split(/\s+/).length < 2) return;
                  e.preventDefault();
                  spread(i, text);
                }}
                onChange={(e) => {
                  // Mobile keyboards type a space without a usable keydown.
                  if (/\s/.test(e.target.value)) {
                    spread(i, e.target.value);
                    return;
                  }
                  const next = [...boxes];
                  next[i] = e.target.value.toLowerCase();
                  emit(next);
                }}
                className='w-full min-w-0 bg-transparent py-1.5 pr-2 pl-10 font-mono text-sm text-text outline-none disabled:cursor-not-allowed disabled:opacity-50'
              />
            </li>
          );
        })}
      </ol>
      {flagged.length > 0 && (
        <ul role='alert' className='mt-2 space-y-1 text-xs text-red'>
          {flagged.map(({ index, word }) => (
            <li key={index} className='break-all'>
              {t('settings.restore.unknownWord', { n: index + 1, word })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
