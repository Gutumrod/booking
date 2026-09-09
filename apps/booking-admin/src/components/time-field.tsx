'use client';

import React, { useState } from 'react';
import { parseTimeInput, stepTime } from '@/lib/time-input';

interface TimeFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Keyboard-friendly HH:MM entry (KMO-02). Type "9", "930", "9:5" etc.; parses on
 * blur / Enter to canonical "HH:MM". Up/Down arrows step by 15 minutes. Invalid
 * input reverts to the last valid value. Value contract unchanged, so no RPC or
 * schema impact.
 */
export function TimeField({ value, onChange, disabled, className, ariaLabel }: TimeFieldProps) {
  const [draft, setDraft] = useState(value);
  // Sync to an external value change during render (React's "adjusting state on
  // prop change" pattern) rather than in an effect.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = () => {
    if (draft.trim() === '') {
      // An empty field is an intentional clear (e.g. removing a break window).
      if (value !== '') onChange('');
      return;
    }
    const parsed = parseTimeInput(draft);
    if (parsed) {
      if (parsed !== value) onChange(parsed);
      setDraft(parsed);
    } else {
      setDraft(value); // revert invalid input to the last valid value
    }
  };

  const step = (deltaMinutes: number) => {
    const next = stepTime(parseTimeInput(draft) ?? value, deltaMinutes);
    setDraft(next);
    onChange(next);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder="HH:MM"
      maxLength={5}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(15);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          step(-15);
        }
      }}
      className={className}
    />
  );
}
