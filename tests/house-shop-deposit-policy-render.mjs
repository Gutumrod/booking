// Real-render harness for the shop deposit policy notice (brief 26).
//
// The claim "a `<script>` in the shop's policy column is never interpreted as
// HTML" can only be proven by actually rendering the component, so this helper
// compiles the real `components/shop-deposit-policy.tsx` (and the real
// `components/legal-document.tsx` it links to) with the esbuild that already
// ships inside this repo's node_modules, and imports the result.
//
// Nothing is stubbed inside the component itself: the only substitutions are the
// modules that cannot run outside Next (the i18n runtime and the icon set), and
// each substitution is a fixed function, so the component's own JSX — and React's
// own escaping — is what the test exercises.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');

/** Fixed strings for the message keys the notice reads (never read from the app). */
const TRANSLATIONS = {
  'booking.policy.shopTitle': 'SHOP_POLICY_TITLE',
  'booking.policy.fallbackNote': 'SHOP_POLICY_FALLBACK',
  'booking.policy.languageNameTh': 'TH',
  'booking.policy.languageNameEn': 'EN',
  'booking.policy.shopOwnedNote': 'SHOP_OWNED_NOTE',
  'booking.policy.notSet': 'SHOP_POLICY_NOT_SET',
  'booking.policy.legalLinkNote': 'LEGAL_LINK_NOTE',
  'legal.meta.navLabel': 'LEGAL_NAV',
  'legal.meta.termsNavLabel': 'TERMS',
  'legal.meta.privacyNavLabel': 'PRIVACY',
  'legal.meta.termsRoute': '/legal/terms',
  'legal.meta.privacyRoute': '/legal/privacy',
};

const STUBS = {
  'next-intl': `
    const T = ${JSON.stringify(TRANSLATIONS)};
    export function useTranslations(scope) {
      return (key, values) => {
        const full = scope ? scope + '.' + key : key;
        const base = T[full];
        if (base === undefined) throw new Error('unstubbed message key: ' + full);
        if (!values) return base;
        return base + ' ' + Object.entries(values).map(([k, v]) => k + '=' + v).join(' ');
      };
    }
    export function useLocale() { return 'th'; }
    export function useMessages() { return { legal: { meta: T } }; }
    export const NextIntlClientProvider = ({ children }) => children ?? null;
  `,
  'lucide-react': `
    const Icon = () => null;
    export const FileText = Icon;
    export const AlertTriangle = Icon;
    export const Scale = Icon;
    export const ArrowLeft = Icon;
  `,
  // next/link is a Client Component that requires the Next runtime; the notice
  // only needs the href it renders, so the stub keeps the real href contract.
  'next/link': `
    import { createElement } from 'react';
    export default function Link(props) {
      return createElement('a', { href: props.href, className: props.className }, props.children);
    }
  `,
};

/**
 * Build the notice component with the real sources and import it.
 * Returns { ShopDepositPolicyNotice, toShopDepositPolicyLocale }.
 */
export async function loadShopDepositPolicyNotice() {
  // A temp directory INSIDE the repo, so the compiled output can resolve bare
  // 'react' / 'react-dom' from the repo's own node_modules. Removed on the way out.
  const dir = mkdtempSync(join(root, 'tests', '.render-'));
  const outfile = join(dir, 'notice.mjs');

  try {
    const result = await esbuild.build({
      stdin: {
        contents: `export { ShopDepositPolicyNotice, toShopDepositPolicyLocale } from ${JSON.stringify(
          join(root, 'apps/booking-consumer/src/components/shop-deposit-policy.tsx'),
        )};`,
        resolveDir: root,
        loader: 'js',
        sourcefile: 'notice-entry.js',
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      jsx: 'automatic',
      outfile,
      logLevel: 'silent',
      // React stays external so the component uses the same React instance the
      // test renders with; everything else is bundled.
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      alias: { '@': join(root, 'apps/booking-consumer/src') },
      plugins: [{
        name: 'stub-runtime-only-modules',
        setup(build) {
          for (const [name, contents] of Object.entries(STUBS)) {
            build.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({ path: name, namespace: 'stub' }));
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => (
              args.path === name ? { contents, loader: 'js' } : null
            ));
          }
        },
      }],
    });
    if (result.errors.length > 0) throw new Error(result.errors.map((e) => e.text).join('\n'));

    const module = await import(pathToFileURL(outfile).href);
    return {
      ShopDepositPolicyNotice: module.ShopDepositPolicyNotice,
      toShopDepositPolicyLocale: module.toShopDepositPolicyLocale,
      translations: TRANSLATIONS,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
