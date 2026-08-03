import { fileURLToPath } from 'node:url';

const dashboardRoot = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: dashboardRoot,
  turbopack: { root: dashboardRoot },
  env: {
    NEXT_PUBLIC_LEGACY_KEEPER_ADDRESS: process.env.LEGACY_KEEPER_ADDRESS ?? '',
    NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL ?? '',
  },
};

export default nextConfig;
