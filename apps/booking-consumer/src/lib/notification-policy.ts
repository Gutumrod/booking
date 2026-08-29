type NotificationAttemptInput = {
  attemptCount: number;
  bookingStatus: string;
  delivered: boolean;
};

export function nextNotificationAttempt(input: NotificationAttemptInput): {
  status: 'pending' | 'sent' | 'failed';
  nextRetrySeconds: number | null;
} {
  if (input.delivered) return { status: 'sent', nextRetrySeconds: null };
  if (input.bookingStatus === 'cancelled' || input.attemptCount >= 5) {
    return { status: 'failed', nextRetrySeconds: null };
  }
  return { status: 'pending', nextRetrySeconds: Math.min(3600, 60 * (2 ** input.attemptCount)) };
}
