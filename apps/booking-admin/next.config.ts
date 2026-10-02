import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
  // ponytail: dev-only tunnel access for remote testing; trycloudflare.com
  // hostnames rotate every run, so this stays a wildcard rather than a fixed host.
  allowedDevOrigins: ['*.trycloudflare.com'],
};

initOpenNextCloudflareForDev();

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
