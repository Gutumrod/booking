// Called only by the guarded, owned-cluster Phase 2 rehearsal.
import assert from 'node:assert/strict';
export async function platformAdminSnapshot(db){
  return {
    functions:await db`select p.oid::text oid,p.oid::regprocedure::text identity,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal') order by 2`,
    relations:await db`select c.oid::regclass::text identity,c.relowner::text owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
    namespaces:await db`select nspname,nspowner::text owner,nspacl::text acl from pg_namespace where nspname in ('local_service','local_service_internal') order by 1`,
  };
}
export function assertAdminRepairDelta(before,after){
  assert.deepEqual(after.relations,before.relations);assert.deepEqual(after.namespaces,before.namespaces);
  assert.equal(after.functions.length,before.functions.length);
  for(let i=0;i<before.functions.length;i++){
    const a=before.functions[i],b=after.functions[i];
    if(a.identity==='local_service.platform_admin_list_shops()'){
      assert.deepEqual({...b,definition:a.definition},a);
      assert.equal(b.definition,a.definition.replace('sub.plan,','sub.plan::text,').replace('sub.status,','sub.status::text,'));
    }else assert.deepEqual(b,a);
  }
}
export async function provePlatformAdmin(db,{repaired=false,planOnlyMutation=false}={}){
  const admin='99180000-0000-4000-8000-000000000001',regular='99180000-0000-4000-8000-000000000002';
  const shop='99180000-0000-4000-8000-000000000011',empty='99180000-0000-4000-8000-000000000012';
  const result={repaired};
  // Fixtures are inserted inside each role-call transaction, never persisted.
  const fixtureCall=async(role,id)=>{
    await db`begin`;
    try{
      await db`insert into auth.users(id,email) values(${admin},'admin-proof@example.test'),(${regular},'regular-proof@example.test')`;
      await db`insert into local_service.platform_admins(user_id) values(${admin})`;
      await db`insert into local_service.shops(id,name,slug) values(${shop},'Admin Proof','admin-proof-180000'),(${empty},'No Subscription','admin-proof-empty-180000')`;
      await db`insert into local_service.subscriptions(shop_id,plan,status) values(${shop},'pro_990','active') on conflict(shop_id) do update set plan='pro_990',status='active'`;
      // Guarantee a true missing-side LEFT JOIN case even if a future shop trigger seeds it.
      await db`delete from local_service.subscriptions where shop_id=${empty}`;
      if(planOnlyMutation){const [f]=await db`select pg_get_functiondef('local_service.platform_admin_list_shops()'::regprocedure) definition`;await db.unsafe(f.definition.replace('sub.plan,','sub.plan::text,')+';');}
      await db.unsafe(`set local role ${role}`);await db`select set_config('request.jwt.claim.sub',${id},true)`;
      return {rows:await db`select * from local_service.platform_admin_list_shops()`};
    }catch(e){return {error:{code:e.code,message:e.message,detail:e.detail}};}
    finally{await db`rollback`;}
  };
  result.admin=await fixtureCall('authenticated',admin);
  if(repaired){
    assert.equal(result.admin.error,undefined);
    const row=result.admin.rows.find(x=>x.shop_id===shop),nullRow=result.admin.rows.find(x=>x.shop_id===empty);
    assert.equal(row.subscription_plan,'pro_990');assert.equal(row.subscription_status,'active');
    for(const key of ['subscription_plan','subscription_status','current_period_end','cancel_at_period_end'])assert.equal(nullRow[key],null);
    result.admin={status:'PASS',subscriptionPlan:row.subscription_plan,subscriptionStatus:row.subscription_status,leftJoinNulls:true};
  }else{assert.equal(result.admin.error?.code,'42804');assert.ok(result.admin.error.detail.includes(`column ${planOnlyMutation?12:11}`));}
  for(const [role,id] of [['authenticated',regular],['anon',regular],['bk01_runtime',regular]]){
    const denied=await fixtureCall(role,id);assert.equal(denied.error?.code,'42501');result[role+'Denial']=denied.error;
  }
  return result;
}
