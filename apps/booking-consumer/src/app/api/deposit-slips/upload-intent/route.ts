import { handleUploadIntent } from '../../../../lib/deposit-slip-upload-intent';

/**
 * The App Router entry point for the deposit-slip upload-intent issuer.
 *
 * The handler lives in `lib/deposit-slip-upload-intent.ts` because Next 16.3.6
 * asserts that a route module exports nothing but the HTTP methods and the
 * documented config symbols (`export async function handleUploadIntent` failed the
 * build as TS2344). The authorization rules and the single allowlisted bucket are
 * documented on the handler; this module only delegates.
 */

export async function POST(req: Request) {
  return handleUploadIntent(req);
}
