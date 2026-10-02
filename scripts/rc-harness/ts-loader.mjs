import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export async function resolve(specifier,context,nextResolve){
 if(specifier==='server-only')return {url:pathToFileURL(path.resolve('node_modules/next/dist/compiled/server-only/empty.js')).href,shortCircuit:true};
 if(specifier.startsWith('.')&&!path.extname(specifier)&&context.parentURL){
  const base=fileURLToPath(new URL(specifier,context.parentURL));
  for(const suffix of ['.ts','.tsx','.js','.mjs','/index.ts','/index.js'])if(fs.existsSync(base+suffix)&&fs.statSync(base+suffix).isFile())return nextResolve(pathToFileURL(base+suffix).href,context);
 }
 return nextResolve(specifier,context);
}
