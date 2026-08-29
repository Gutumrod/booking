const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function buildDepositSlipObjectPath(
  bookingId: string,
  contentType: string,
  objectId: string = crypto.randomUUID(),
): string {
  if (!UUID_PATTERN.test(bookingId) || !UUID_PATTERN.test(objectId)) {
    throw new Error('Invalid booking or object identifier');
  }

  const extension = EXTENSION_BY_MIME[contentType];
  if (!extension) throw new Error('Unsupported deposit slip content type');
  return `${bookingId}/${objectId}.${extension}`;
}

export function isBookingScopedDepositSlipPath(bookingId: string, objectPath: string): boolean {
  if (!UUID_PATTERN.test(bookingId) || objectPath.includes('://') || objectPath.includes('..')) {
    return false;
  }

  const [pathBookingId, fileName, ...rest] = objectPath.split('/');
  return rest.length === 0
    && pathBookingId === bookingId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(fileName ?? '');
}

