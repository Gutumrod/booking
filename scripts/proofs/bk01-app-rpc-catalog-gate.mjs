import { createRpcSourceResolver, matchingRpcIdentities } from '../lib/bk01-rpc-source-shapes.mjs';
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import postgres from 'postgres';
const root=path.resolve(process.argv[2]||'.');
if(process.env.BK01_SHARED_RUNTIME_ENV!=='local'||!process.env.BK01_P0_LOCAL_URL||new URL(process.env.BK01_P0_LOCAL_URL).hostname!=='127.0.0.1')throw Error('local-only catalog gate');
const db=postgres(process.env.BK01_P0_LOCAL_URL,{max:1,prepare:false});
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!['node_modules','.next','.open-next'].includes(e.name)?files(path.join(dir,e.name)):e.isFile()&&/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]);}
const program=ts.createProgram(files(path.join(root,'apps')),{target:ts.ScriptTarget.Latest,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,allowJs:true,skipLibCheck:true});
const sources=program.getSourceFiles().filter(ast=>path.resolve(ast.fileName).startsWith(path.join(root,'apps')+path.sep)&&!ast.isDeclarationFile).map(ast=>({file:ast.fileName,ast}));
if(!sources.length)throw Error('No application source files scanned');
const {values,shapes}=createRpcSourceResolver(program);
function walk(n,fn){fn(n);ts.forEachChild(n,x=>walk(x,fn));}
let count=0;const failures=[],calls=[];
try{
 const probe=postgres(process.env.BK01_P0_LOCAL_URL.replace(/\/\/[^@]+@/,'//fixture_admin@'),{max:1});
 try{const [guard]=await probe`select current_setting('data_directory') data`;if(!process.env.BK01_P0_DATA_DIR||guard.data.replaceAll('\\','/')!==process.env.BK01_P0_DATA_DIR.replaceAll('\\','/'))throw Error('exact disposable data directory mismatch');}finally{await probe.end();}

 const cat=await db.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');return tx`select p.proname,p.oid::regprocedure::text identity,p.proargnames,p.pronargs,p.pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service'`;});
 for(const {file,ast} of sources){walk(ast,n=>{
  if(!ts.isCallExpression(n)||!ts.isPropertyAccessExpression(n.expression)||n.expression.name.text!=='rpc')return;
  const loc=ast.getLineAndCharacterOfPosition(n.getStart(ast));
  try{const names=values(n.arguments[0]),args=shapes(n.arguments[1]);if(!names.length)throw Error('Unresolved RPC name '+n.arguments[0]?.getText());
   // Conditional name/shape branches correspond in source order; each branch must resolve exactly once.
   for(let i=0;i<names.length;i++){const name=names[i],keys=args.length===names.length?args[i]:args[0];const matches=matchingRpcIdentities(cat,name,keys);if(matches.length!==1)throw Error(name+' keys='+keys.join(',')+' catalogMatches='+matches.length);count++;calls.push({file:path.relative(root,file),line:loc.line+1,name,args:keys,identity:matches[0].identity});}
  }catch(e){failures.push({file:path.relative(root,file),line:loc.line+1,error:e.message});}
 });}
 if(!count)failures.push({error:'No application RPC calls checked'});
 console.log(JSON.stringify({root,checked:count,failures},null,2));if(process.env.BK01_P0_EVIDENCE_DIR)fs.writeFileSync(path.join(process.env.BK01_P0_EVIDENCE_DIR,'rpc-catalog-arity.json'),JSON.stringify({root,calls,failures},null,2));if(failures.length)process.exitCode=1;
}finally{await db.end();}
