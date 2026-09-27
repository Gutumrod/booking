import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    const serverOnlyPath = path.resolve('node_modules/next/dist/compiled/server-only/empty.js');
    return { url: pathToFileURL(serverOnlyPath).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || path.extname(specifier)) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
