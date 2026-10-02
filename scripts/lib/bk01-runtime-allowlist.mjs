// BK01 Data API runtime contract. This is intentionally operation-specific: these
// are the RPCs currently called with the server-only service-role client. Direct
// table and Storage API operations require separate source remediation and are not
// authorized by this contract.
export const BK01_RUNTIME_ROLE = 'bk01_runtime';
export const BK01_RUNTIME_SCHEMA = 'local_service';
export const BK01_RUNTIME_BOOTSTRAP_FUNCTIONS = Object.freeze([
  'local_service.authorize_booking_recovery_attempt(uuid,text)',
  'local_service.claim_due_line_notifications(integer)',
  'local_service.claim_stripe_webhook_event(text,text,timestamp with time zone)',
  'local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text)',
  'local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean)',
]);

export const BK01_RUNTIME_ROUTE_FUNCTIONS = Object.freeze([
  'local_service.authorize_deposit_slip_upload(uuid,text,text,bigint)',
  'local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text)',
  'local_service.bk01_line_bind_booking(text,text,text,uuid,text)',
  'local_service.bk01_line_bind_booking_trial(text,text,text,text)',
  'local_service.finish_stripe_webhook_event(text,text,text)',
  'local_service.get_line_notification_delivery_context(uuid,integer)',
  'local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean)',
  'local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text)',
]);

export const BK01_RUNTIME_FUNCTIONS = Object.freeze([
  ...BK01_RUNTIME_BOOTSTRAP_FUNCTIONS,
  ...BK01_RUNTIME_ROUTE_FUNCTIONS,
].sort());

// Fixed legacy exception set accepted by the WSTERA House caretaker on 2026-09-27
// (Lane B WU-2 round 2). Keep separate from the twelve explicit runtime RPC grants.
export const BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS = Object.freeze([
  'local_service.audit_platform_admin_update()',
  'local_service.enforce_booking_status_transition()',
  'local_service.enforce_ticket_owner_admin()',
  'local_service.enqueue_booking_notifications()',
  'local_service.generate_booking_code()',
  'local_service.generate_link_token()',
  'local_service.is_shop_member(uuid)',
  'local_service.suppress_new_overdue_line_reminder()',
]);

export const BK01_RUNTIME_EFFECTIVE_FUNCTIONS = Object.freeze([
  ...BK01_RUNTIME_FUNCTIONS,
  ...BK01_PUBLIC_LEGACY_EXECUTE_EXCEPTIONS,
]);

export function validateBk01RuntimeEffectiveExecuteSet(observed, sourceName = 'catalog') {
  const expected = new Set(BK01_RUNTIME_EFFECTIVE_FUNCTIONS.map(norm));
  const actual = observed.map(norm);
  const extras = actual.filter((identity) => !expected.has(identity));
  const missing = [...expected].filter((identity) => !actual.includes(identity));
  if (extras.length || missing.length || actual.length !== expected.size) {
    throw new Error(`${sourceName} effective EXECUTE differs from exact allowlist; extras=${extras.join(',')}; missing=${missing.join(',')}`);
  }
  return true;
}

const norm = (value) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  .replace(/\btimestamptz\b/g, 'timestamp with time zone')
  .replace(/\bint\b/g, 'integer');

function splitTargets(value) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

/** Validate explicit grants/role attributes which give authority to bk01_runtime. */
export function validateBk01RuntimeAuthority(sql, sourceName = 'SQL') {
  const body = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
  const functionAllowlist = new Set(BK01_RUNTIME_FUNCTIONS.map(norm));

  if (/\b(?:create|alter)\s+(?:role|user)\s+bk01_runtime\b[^;]*\blogin\b/i.test(body)) {
    throw new Error(`${sourceName} grants LOGIN to bk01_runtime`);
  }

  // Role membership is allowed only in the H3A direction: the authenticator may
  // SET ROLE to bk01_runtime, without inheriting it.
  for (const match of body.matchAll(/\bgrant\s+([^;]+?)\s+to\s+([^;]+);/gi)) {
    const granted = norm(match[1]);
    if (granted === BK01_RUNTIME_ROLE) {
      const members = splitTargets(match[2].replace(/\s+with\s+[\s\S]*$/i, ''));
      if (members.length !== 1 || norm(members[0]) !== 'authenticator'
          || !/\bwith\s+inherit\s+false\s*,\s*set\s+true\s*$/i.test(match[2])) {
        throw new Error(`${sourceName} grants bk01_runtime membership outside SET-only authenticator access`);
      }
    }
  }

  for (const statement of body.match(/\bgrant\b[^;]*;/gi) ?? []) {
    const match = statement.match(/\bgrant\s+([\s\S]*?)\s+on\s+(schema|function|routine|type|table|all\s+tables|all\s+functions)\s+([\s\S]*?)\s+to\s+([^;]+);/i);
    if (!match) continue;
    const [, privileges, kindRaw, targetsRaw, granteesRaw] = match;
    const kind = norm(kindRaw);
    const grantees = splitTargets(granteesRaw.replace(/\s+with\s+grant\s+option\s*$/i, ''))
      .map((role) => norm(role));
    if (!grantees.includes(BK01_RUNTIME_ROLE)) continue;

    if (kind === 'schema') {
      const schemas = splitTargets(targetsRaw).map((schema) => norm(schema));
      if (schemas.some((schema) => schema !== BK01_RUNTIME_SCHEMA)
          || !/^usage$/i.test(privileges.trim())) {
        throw new Error(`${sourceName} grants bk01_runtime authority outside USAGE on local_service`);
      }
      continue;
    }

    if (kind === 'type') {
      if (norm(targetsRaw) !== 'local_service.bk01_ops_alert_kind' || !/^usage$/i.test(privileges.trim())) throw new Error(`${sourceName} grants bk01_runtime unapproved type authority`);
      continue;
    }
    if (kind !== 'function' && kind !== 'routine') {
      throw new Error(`${sourceName} grants bk01_runtime table or broad object authority`);
    }
    if (!/^execute$/i.test(privileges.trim())) {
      throw new Error(`${sourceName} grants bk01_runtime non-EXECUTE function authority`);
    }
    const targets = splitTargets(targetsRaw).map(norm);
    for (const target of targets) {
      const historicalEmail = target === 'local_service.claim_due_shop_email_notifications(integer)'
        && ['20261001140000_bk01_pack_notify_group67.sql','20261002120000_bk01_council_p0.sql'].includes(sourceName);
      if (!functionAllowlist.has(target) && !historicalEmail) {
        throw new Error(`${sourceName} grants bk01_runtime non-allowlisted function: ${target}`);
      }
    }
  }

  return true;
}
