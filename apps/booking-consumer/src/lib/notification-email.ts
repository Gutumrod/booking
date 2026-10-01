/**
 * The merchant notification e-mail body (BK01 brief 23, part B3(ข)).
 *
 * Owner decision: keep it minimal. The e-mail may carry ONLY the shop name, the
 * count plus the queue codes, and the link into the admin. It must never carry a
 * customer name or phone, an amount, or a slip image/path -- an inbox is a
 * weaker boundary than the admin session, so no booking detail travels in it.
 *
 * The input type itself is the first guard: `buildMerchantEmail` reads three
 * named fields and nothing else, so extra properties on the caller's object
 * cannot reach the body. `tests/notification-email.test.ts` hands it an object
 * deliberately stuffed with customer name, phone, amount and slip path and
 * asserts none of them appear.
 */

export interface MerchantEmailInput {
  /** The shop's own display name, as read from the shop row. */
  shopName: string;
  /** Queue codes only -- never the customer behind them. */
  queueCodes: readonly string[];
  /** Absolute URL of the admin bookings screen. */
  adminUrl: string;
  kind: MerchantEmailKind;
}

export type MerchantEmailKind = 'immediate' | 'daily_summary';

export interface MerchantEmail {
  subject: string;
  text: string;
  html: string;
}

/** Codes are printed, so a malformed one is dropped rather than rendered. */
const QUEUE_CODE_PATTERN = /^[A-Za-z0-9-]{3,32}$/;
const MAX_CODES_IN_BODY = 50;

function sanitizeCodes(queueCodes: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const code of queueCodes) {
    const trimmed = String(code ?? '').trim();
    if (!QUEUE_CODE_PATTERN.test(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
    if (clean.length === MAX_CODES_IN_BODY) break;
  }
  return clean;
}

function sanitizeShopName(shopName: string): string {
  return String(shopName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Bilingual by construction (L-01): the shop is not asked for a locale, so both
 * languages ride in the one message the same way the admin catalogue carries both.
 */
export function buildMerchantEmail(input: MerchantEmailInput): MerchantEmail {
  const shopName = sanitizeShopName(input.shopName);
  const codes = sanitizeCodes(input.queueCodes);
  const adminUrl = String(input.adminUrl ?? '').trim();
  const count = codes.length;
  const codeList = codes.length > 0 ? codes.join(', ') : '-';

  const subject = input.kind === 'daily_summary'
    ? `[${shopName}] สรุปรายการรอตรวจสอบวันนี้ · Daily review summary (${count})`
    : `[${shopName}] มีรายการรอตรวจสอบใหม่ · New item awaiting review (${count})`;

  const thLines = [
    `ร้าน: ${shopName}`,
    `จำนวนรายการรอตรวจสอบ: ${count}`,
    `รหัสคิว: ${codeList}`,
    `เปิดหลังบ้าน: ${adminUrl}`,
  ];
  const enLines = [
    `Shop: ${shopName}`,
    `Items awaiting review: ${count}`,
    `Queue codes: ${codeList}`,
    `Open the admin: ${adminUrl}`,
  ];

  const text = [
    'มีรายการรอตรวจสอบในหลังบ้านร้านของคุณ / Items awaiting review in your admin',
    '',
    thLines.join('\n'),
    '',
    enLines.join('\n'),
  ].join('\n');

  const html = [
    '<p>มีรายการรอตรวจสอบในหลังบ้านร้านของคุณ<br />Items awaiting review in your admin</p>',
    '<ul>',
    `<li>ร้าน / Shop: ${escapeHtml(shopName)}</li>`,
    `<li>จำนวนรายการรอตรวจสอบ / Items awaiting review: ${count}</li>`,
    `<li>รหัสคิว / Queue codes: ${escapeHtml(codeList)}</li>`,
    `<li><a href="${escapeHtml(adminUrl)}">เปิดหลังบ้าน / Open the admin</a></li>`,
    '</ul>',
  ].join('');

  return { subject, text, html };
}
