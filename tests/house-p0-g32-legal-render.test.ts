/**
 * BK01 P0 — G32 (council finding): `[[OWNER INPUT: …]]` placeholders from the message
 * catalogues were reaching the customer's SCREEN on the legal pages.
 *
 * WHAT THIS PROVES, AND WHY IT IS A TEST AND NOT A COPY EDIT. The facts behind those
 * placeholders do not exist yet: the Owner has not supplied them and a qualified legal
 * reviewer has not passed the wording. So the catalogue must keep the placeholders —
 * `scripts/check-owner-input-placeholders.mjs --enforce` is SUPPOSED to keep failing
 * until the facts arrive — and the fix must happen at RENDER time instead. A "fix" that
 * deleted the placeholders would invent a fact and destroy the record of what is still
 * missing, so this file pins BOTH halves:
 *
 *   1. every customer-visible legal string, after render-time neutralisation, carries
 *      no `[[…]]` run — for BOTH locales and BOTH documents;
 *   2. the raw catalogue STILL carries its placeholders, counted independently of the
 *      module under test, so the green in (1) cannot have come from deleting them;
 *   3. the component actually routes each of those strings through
 *      `renderNeutralPlaceholders`, and still renders the draft notice on screen.
 *
 * Static and dependency-free: it reads JSON and TypeScript/TSX source, imports one pure
 * module, opens no database connection, reads no .env file and makes no network request.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  OWNER_INPUT_PATTERN,
  containsOwnerInputPlaceholder,
  countOwnerInputPlaceholders,
  renderNeutralPlaceholders,
} from '../apps/booking-consumer/src/lib/legal-placeholder.ts';

const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const readJson = (rel: string) => JSON.parse(read(rel));

/** The neutral replacement text, verbatim, as the Owner-facing copy defines it. */
const NEUTRAL_VALUE = {
  th: 'ยังไม่ยืนยัน (รอการอนุมัติจากเจ้าของผลิตภัณฑ์)',
  en: 'Not yet confirmed (pending Owner approval)',
} as const;

type Locale = keyof typeof NEUTRAL_VALUE;
const locales: Locale[] = ['th', 'en'];
const documentKeys = ['terms', 'privacy'] as const;
const metaKey = 'pendingOwnerValue';

type LegalSection = { h: string; b: string };
type LegalDoc = { title: string; subtitle: string; intro: string; sections: Record<string, LegalSection> };
type LegalMessages = {
  legal: {
    meta: Record<string, string>;
    terms: LegalDoc;
    privacy: LegalDoc;
  };
};

const messages = {
  th: readJson('apps/booking-consumer/messages/th.json') as LegalMessages,
  en: readJson('apps/booking-consumer/messages/en.json') as LegalMessages,
};

const catalogPath = (locale: Locale) => `apps/booking-consumer/messages/${locale}.json`;

/**
 * Every string the customer can read on a rendered legal page, paired with the value
 * the component must put on screen for it. Built here rather than in the component so
 * the test does not inherit the component's own mistakes.
 */
function customerVisibleStrings(locale: Locale, documentKey: (typeof documentKeys)[number]) {
  const doc = messages[locale].legal[documentKey];
  const pending = messages[locale].legal.meta[metaKey];
  const surfaces: { label: string; raw: string; rendered: string }[] = [];
  const add = (label: string, raw: string) => {
    surfaces.push({ label: `${locale}.${documentKey}.${label}`, raw, rendered: renderNeutralPlaceholders(raw, pending) });
  };
  add('title', doc.title);
  add('subtitle', doc.subtitle);
  add('intro', doc.intro);
  for (const [key, section] of Object.entries(doc.sections)) {
    add(`sections.${key}.h`, section.h);
    add(`sections.${key}.b`, section.b);
  }
  add('meta.ownerInputLegend', messages[locale].legal.meta.ownerInputLegend);
  add('meta.lastUpdatedValue', messages[locale].legal.meta.lastUpdatedValue);
  return surfaces;
}

/** A scan written WITHOUT the module under test, so deletion shows up as a disagreement. */
const independentPattern = /\[\[[\s\S]*?\]\]/g;
const independentCount = (text: string) => (text.match(independentPattern) ?? []).length;

test('the module exposes the shared placeholder pattern and counts it, without React or next-intl', () => {
  assert.ok(OWNER_INPUT_PATTERN instanceof RegExp, 'OWNER_INPUT_PATTERN must be a RegExp');
  assert.match(OWNER_INPUT_PATTERN.source, /\\\[\\\[/);
  assert.ok(OWNER_INPUT_PATTERN.global, 'the pattern must be global or a replace would stop at the first run');

  assert.equal(countOwnerInputPlaceholders('no placeholder here'), 0);
  assert.equal(countOwnerInputPlaceholders('a [[ONE]] b [[TWO]]'), 2);
  assert.equal(containsOwnerInputPlaceholder('a [[ONE]] b'), true);
  assert.equal(containsOwnerInputPlaceholder('a b'), false);
  // Adjacent runs must not swallow each other, and the replacement is literal, not a
  // `$&`-style substitution pattern.
  assert.equal(renderNeutralPlaceholders('[[ONE]][[TWO]]', 'X'), 'XX');
  assert.equal(renderNeutralPlaceholders('a [[ONE]] b', '$&'), 'a $& b');
  assert.equal(renderNeutralPlaceholders('nothing', 'X'), 'nothing');

  const source = read('apps/booking-consumer/src/lib/legal-placeholder.ts');
  assert.doesNotMatch(source, /from '(react|next-intl|@\/)/, 'the module must stay dependency-free');
});

test('every customer-visible legal string reaches the screen with no [[...]] placeholder, both locales, both documents', () => {
  for (const locale of locales) {
    for (const documentKey of documentKeys) {
      for (const surface of customerVisibleStrings(locale, documentKey)) {
        assert.equal(
          countOwnerInputPlaceholders(surface.rendered),
          0,
          `${surface.label} still renders a placeholder: ${surface.rendered.slice(0, 200)}`,
        );
        assert.equal(containsOwnerInputPlaceholder(surface.rendered), false, `${surface.label} still renders a placeholder`);
      }
    }
  }

  // The neutralised value is only worth anything if the PAGE actually applies it, so the
  // wiring is pinned in the same test: a module the component never calls would leave a
  // green module and a leaking screen, which is exactly the defect G32 reports.
  const component = read('apps/booking-consumer/src/components/legal-document.tsx');
  for (const pattern of [
    /\{doc\.title\}/,
    /\{doc\.subtitle\}/,
    /\{doc\.intro\}/,
    /\{section\.h\}/,
    /\{section\.b\}/,
    /\{t\('ownerInputLegend'\)\}/,
    /\{t\('lastUpdatedValue'\)\}/,
  ]) {
    assert.doesNotMatch(component, pattern, `the component still renders the raw catalogue value matching ${pattern}`);
  }
  for (const pattern of [
    /renderNeutralPlaceholders\(doc\.title, pending\)/,
    /renderNeutralPlaceholders\(doc\.subtitle, pending\)/,
    /renderNeutralPlaceholders\(doc\.intro, pending\)/,
    /renderNeutralPlaceholders\(section\.h, pending\)/,
    /renderNeutralPlaceholders\(section\.b, pending\)/,
    /renderNeutralPlaceholders\(t\('ownerInputLegend'\), pending\)/,
    /renderNeutralPlaceholders\(t\('lastUpdatedValue'\), pending\)/,
  ]) {
    assert.match(component, pattern, `the component does not neutralise ${pattern} before rendering it`);
  }
  assert.match(component, /const pending = messages\.legal\.meta\.pendingOwnerValue;/);
});

test('the raw catalogues still carry the original placeholders — the fix is a render-time substitution, not a deletion', () => {
  for (const locale of locales) {
    // The meta strings are shared by both documents, so they are counted once each
    // while the per-document section strings are unioned: the raw total must reconcile
    // exactly with the file's own placeholder count.
    const rawStrings = new Set<string>();
    let renderedTotal = 0;
    for (const documentKey of documentKeys) {
      for (const surface of customerVisibleStrings(locale, documentKey)) {
        const raw = countOwnerInputPlaceholders(surface.raw);
        // the count on the raw value must agree with a scan that does not use the module
        assert.equal(independentCount(surface.raw), raw, `${surface.label} raw count disagrees with an independent scan`);
        rawStrings.add(surface.raw);
        renderedTotal += countOwnerInputPlaceholders(surface.rendered);
      }
    }
    const rawTotal = Array.from(rawStrings).reduce((sum, text) => sum + independentCount(text), 0);
    assert.ok(rawTotal > 0, `${locale} legal copy must still carry Owner-input placeholders until the Owner supplies the facts`);
    assert.equal(renderedTotal, 0, `${locale}: a placeholder survived into the rendered copy`);

    // Nothing was deleted: the whole file holds exactly as many placeholders as the
    // legal copy did, and every one of them is still an OWNER INPUT.
    const fileText = read(catalogPath(locale));
    const legalText = JSON.stringify(messages[locale].legal);
    const fileCount = independentCount(fileText);
    assert.equal(fileCount, rawTotal, `${locale}.json lost or gained a placeholder: file has ${fileCount}, legal copy neutralises ${rawTotal}`);
    assert.equal((legalText.match(/\[\[OWNER INPUT:/g) ?? []).length, fileCount, `${locale}.json carries a placeholder that is not an OWNER INPUT`);
    assert.equal((legalText.match(/\[\[[^\]]*\]\]/g) ?? []).length, fileCount, `${locale}.json count disagrees with the gate's pattern`);
  }
});

test('the component routes every customer-visible legal string through renderNeutralPlaceholders and still shows the draft notice', () => {
  const component = read('apps/booking-consumer/src/components/legal-document.tsx');
  assert.match(component, /import \{ renderNeutralPlaceholders \} from '@\/lib\/legal-placeholder';/);
  assert.match(component, /const pending = messages\.legal\.meta\.pendingOwnerValue;/);
  assert.match(component, /const pending = meta\.pendingOwnerValue;/);

  // The pre-fix interpolations must be gone: each of these put the CATALOGUE value
  // straight into the DOM, placeholder and all.
  const leaked = [
    /\{doc\.title\}/,
    /\{doc\.subtitle\}/,
    /\{doc\.intro\}/,
    /\{section\.h\}/,
    /\{section\.b\}/,
    /\{t\('ownerInputLegend'\)\}/,
    /\{t\('lastUpdatedValue'\)\}/,
  ];
  for (const pattern of leaked) {
    assert.doesNotMatch(component, pattern, `${component} still renders the raw catalogue value matching ${pattern}`);
  }

  // And every customer-visible surface is now neutralised where it is rendered.
  const neutralised = [
    /renderNeutralPlaceholders\(doc\.title, pending\)/,
    /renderNeutralPlaceholders\(doc\.subtitle, pending\)/,
    /renderNeutralPlaceholders\(doc\.intro, pending\)/,
    /renderNeutralPlaceholders\(section\.h, pending\)/,
    /renderNeutralPlaceholders\(section\.b, pending\)/,
    /renderNeutralPlaceholders\(t\('ownerInputLegend'\), pending\)/,
    /renderNeutralPlaceholders\(t\('lastUpdatedValue'\), pending\)/,
  ];
  for (const pattern of neutralised) {
    assert.match(component, pattern, `the component does not neutralise ${pattern} before rendering it`);
  }
  // The neutralised title is what the draft notice is told, twice.
  assert.equal((component.match(/documentTitle=\{title\}/g) ?? []).length, 2);
  assert.doesNotMatch(component, /documentTitle=\{doc\.title\}/);

  // The draft badge and notice stay on screen: the page must still say it is a draft.
  assert.equal((component.match(/<LegalDraftNotice /g) ?? []).length, 2, 'LegalDraftNotice must render at both ends of the document');
  assert.match(component, /role="note"/);
  assert.doesNotMatch(component, /hidden/, 'the draft marker must never be hidden at any breakpoint');
  for (const key of ['draftBadge', 'draftBody', 'draftFooter']) {
    assert.ok(component.includes(`t('${key}')`), `the draft notice must still render ${key}`);
  }
});

test('the neutral replacement text is the pinned value in both catalogues, at the same key path, with no placeholder and no invented fact', () => {
  for (const locale of locales) {
    const meta = messages[locale].legal.meta;
    assert.equal(typeof meta[metaKey], 'string', `${catalogPath(locale)} legal.meta.${metaKey} must exist`);
    assert.equal(meta[metaKey], NEUTRAL_VALUE[locale], `${locale} legal.meta.${metaKey} must be the pinned neutral value`);
    assert.equal(containsOwnerInputPlaceholder(meta[metaKey]), false, `${locale} ${metaKey} must not contain a placeholder`);
    // It states only that the value is not confirmed: no commercial term, no number,
    // no date, no legal claim.
    assert.doesNotMatch(meta[metaKey], /\d/, `${locale} ${metaKey} must not state a figure or a date`);
    assert.doesNotMatch(meta[metaKey], /฿|\$|100%|guarantee|รับประกัน/i, `${locale} ${metaKey} must not state a commercial term or guarantee`);
  }
  // Identical key path in both catalogues, so neither locale can drift alone.
  const thKeys = Object.keys(messages.th.legal.meta).sort();
  const enKeys = Object.keys(messages.en.legal.meta).sort();
  assert.deepEqual(enKeys, thKeys, 'the legal meta key sets differ between locales');
  assert.ok(thKeys.includes(metaKey));
});

test('Thai stays Thai and English stays English in the neutralised render', () => {
  for (const documentKey of documentKeys) {
    const th = customerVisibleStrings('th', documentKey);
    const en = customerVisibleStrings('en', documentKey);
    for (const surface of th) {
      assert.doesNotMatch(surface.rendered, /\[\[|\]\]/, `${surface.label} still shows placeholder brackets`);
    }
    for (const surface of en) {
      assert.doesNotMatch(surface.rendered, /\[\[|\]\]/, `${surface.label} still shows placeholder brackets`);
    }
    // The Thai page reads Thai where the catalogue wrote Thai; substituting the neutral
    // value must not have overwritten the surrounding prose with the English one.
    const thDoc = messages.th.legal[documentKey];
    assert.match(thDoc.title, /[\u0E00-\u0E7F]/);
    assert.match(thDoc.subtitle, /[\u0E00-\u0E7F]/);
    assert.match(thDoc.intro, /[\u0E00-\u0E7F]/);
    assert.match(messages.th.legal.meta[metaKey], /[\u0E00-\u0E7F]/, 'the Thai neutral value must be written in Thai');
    assert.doesNotMatch(messages.en.legal.meta[metaKey], /[\u0E00-\u0E7F]/, 'the English neutral value must not carry Thai script');
    assert.notEqual(messages.th.legal[documentKey].title, messages.en.legal[documentKey].title, 'the two locales must not collapse into one');
    assert.equal(th.length, en.length, 'both locales must expose the same customer-visible surfaces');
  }
});
