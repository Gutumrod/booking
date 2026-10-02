import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { localeCookieName, resolveLocale } from './config';
import { getMessages } from './messages';

/**
 * next-intl server request configuration.
 *
 * The server layouts (dashboard, platform-admin) call getLocale()/
 * getTranslations() from 'next-intl/server'. Without this module next-intl
 * throws "Couldn't find next-intl config file" and those routes answer 500.
 *
 * The locale comes from the existing 'saas_locale' cookie through the existing
 * config helpers, messages from the existing catalogue, and the time zone the
 * client provider already used. No [locale] segment, no routing.
 */
export default getRequestConfig(async ({ locale }) => {
  const cookieStore = await cookies();
  const resolved = resolveLocale(locale ?? cookieStore.get(localeCookieName)?.value);

  return {
    locale: resolved,
    messages: getMessages(resolved),
    timeZone: 'Asia/Bangkok',
  };
});
