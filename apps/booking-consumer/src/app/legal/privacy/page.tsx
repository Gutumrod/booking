import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal-document';

// Reached before any payment step: these routes are linked from the landing page
// and from the customer booking page footer.
export const metadata: Metadata = {
  title: 'Privacy Policy — pre-launch draft',
  description: 'Unreviewed pre-launch draft. Awaiting Owner approval and qualified legal review.',
};

export default function PrivacyPage() {
  return <LegalDocument documentKey="privacy" />;
}
