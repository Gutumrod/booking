// Module-resolution hook for tests/f14-entitlement-visibility.test.ts.
//
// apps/booking-consumer/src/lib/booking-service.ts imports its Supabase client
// and its result adapters with extensionless relative specifiers (`./supabase`,
// `./load-result`), which Node's ESM resolver cannot resolve when that file is
// loaded directly from `tests/` with type stripping. Next.js resolves them; Node
// does not.
//
// This hook does two things, and nothing else:
//
//   1. redirects `./supabase` from the consumer lib to the test double next to
//      this file (tests/entitlement-supabase-stub.ts), so the suite never loads
//      the app client's environment and never depends on a real endpoint;
//   2. retries a relative specifier that fails to resolve with a `.ts`
//      extension appended, which is exactly what bundler resolution does.
//
// The REAL exported accessors under test stay under test: only their transport
// is replaced, by the suite's stubbed `globalThis.fetch`, which answers the way
// PostgREST does (including the `in.(...)` id filter and error bodies).

const CONSUMER_LIB = /\/apps\/booking-consumer\/src\/lib\//;
const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]s$/;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? '';

  if (specifier === './supabase' && CONSUMER_LIB.test(parent)) {
    return {
      url: new URL('./entitlement-supabase-stub.ts', import.meta.url).href,
      shortCircuit: true,
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}
