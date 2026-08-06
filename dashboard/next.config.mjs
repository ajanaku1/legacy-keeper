import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

loadEnvConfig(projectRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  env: {
    NEXT_PUBLIC_LEGACY_KEEPER_ADDRESS: process.env.LEGACY_KEEPER_ADDRESS ?? '',
    NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL ?? '',
  },
};

export default nextConfig;
