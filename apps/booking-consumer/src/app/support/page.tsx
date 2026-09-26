'use client';

import { LanguageToggle } from '@/components/language-toggle';
import { SupportContact } from '@/components/support-contact';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <LanguageToggle variant="booking" />
      <main className="mx-auto w-full max-w-md px-4 py-16">
        <SupportContact />
      </main>
    </div>
  );
}
