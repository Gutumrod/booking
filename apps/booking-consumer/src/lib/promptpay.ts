type PromptPayPayloadInput = {
  recipient: string;
  amount: number;
};

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function normalizeRecipient(recipient: string): { tag: '01' | '02'; value: string } {
  const digits = recipient.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) {
    return { tag: '01', value: `0066${digits.slice(1)}` };
  }
  if (/^\d{13}$/.test(digits)) {
    return { tag: '02', value: digits };
  }
  throw new Error('Invalid PromptPay recipient');
}

export function crc16CcittFalse(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function createPromptPayPayload({ recipient, amount }: PromptPayPayloadInput): string {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99) {
    throw new Error('Invalid PromptPay amount');
  }

  const target = normalizeRecipient(recipient);
  const merchantAccount = tlv('00', 'A000000677010111') + tlv(target.tag, target.value);
  const body = [
    tlv('00', '01'),
    tlv('01', '12'),
    tlv('29', merchantAccount),
    tlv('53', '764'),
    tlv('54', amount.toFixed(2)),
    tlv('58', 'TH'),
  ].join('');
  const withCrcTag = `${body}6304`;
  return `${withCrcTag}${crc16CcittFalse(withCrcTag)}`;
}
