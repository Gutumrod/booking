'use client';

import { Mail, MessageCircle, PhoneOff, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { resolveSupportChannels, type SupportChannel } from '@/lib/support-channel';

// Contact values come from configuration only (L-13). Nothing here may fall
// back to a hard-coded address, LINE identifier, phone number or endpoint.
const supportEnv = {
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_SUPPORT_LINE_OA_ID: process.env.NEXT_PUBLIC_SUPPORT_LINE_OA_ID,
};

function ChannelRow({
  channel,
  label,
  icon,
}: {
  channel: SupportChannel;
  label: string;
  icon: React.ReactNode;
}) {
  const t = useTranslations('support');
  const unresolved = channel.value === null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
        {icon}
        <span>{label}</span>
      </div>
      {unresolved ? (
        <div className="space-y-1">
          <p className="text-xs text-amber-300">{t('valuePending')}</p>
          <code className="block break-all rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 font-mono text-[11px] text-amber-200">
            {channel.placeholder}
          </code>
          <p className="text-[11px] text-slate-400">{t('ownerInputNote')}</p>
        </div>
      ) : (
        <a
          href={channel.href ?? undefined}
          target={channel.kind === 'line' ? '_blank' : undefined}
          rel={channel.kind === 'line' ? 'noopener noreferrer' : undefined}
          className="block break-all font-mono text-xs font-bold text-emerald-400 hover:underline"
        >
          {channel.value}
        </a>
      )}
    </div>
  );
}

export function SupportContact() {
  const t = useTranslations('support');
  const channels = resolveSupportChannels(supportEnv);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-white">{t('title')}</h1>
        <p className="text-xs text-slate-400">{t('subtitle')}</p>
      </div>

      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
          <MessageCircle className="w-4 h-4 flex-shrink-0" />
          <span>{t('writtenOnlyTitle')}</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">{t('writtenOnlyBody')}</p>
      </div>

      <div
        role="note"
        className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300"
      >
        <PhoneOff className="w-4 h-4 flex-shrink-0 text-rose-400" />
        <span>{t('noLiveCall')}</span>
      </div>

      <div className="space-y-3">
        <ChannelRow channel={channels.email} label={t('emailLabel')} icon={<Mail className="w-4 h-4 text-emerald-400" />} />
        <ChannelRow channel={channels.line} label={t('lineLabel')} icon={<MessageCircle className="w-4 h-4 text-emerald-400" />} />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Info className="w-4 h-4 flex-shrink-0 text-slate-400" />
          <span>{t('whatToInclude')}</span>
        </div>
        <p className="text-xs text-slate-400">{t('includeBookingCode')}</p>
        <p className="text-[11px] text-slate-500">{t('privacyNote')}</p>
      </div>
    </div>
  );
}
