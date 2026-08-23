import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
  // ponytail: dev-only tunnel access for remote testing; trycloudflare.com
  // hostnames rotate every run, so this stays a wildcard rather than a fixed host.
  allowedDevOrigins: ['*.trycloudflare.com'],
};

initOpenNextCloudflareForDev();

export default nextConfig;
