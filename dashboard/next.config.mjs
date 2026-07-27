/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_LEGACY_KEEPER_ADDRESS: process.env.LEGACY_KEEPER_ADDRESS ?? '',
    NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL ?? '',
  },
  webpack: (config) => {
    // wagmi/connectors is a barrel: importing injected() also pulls in the
    // Coinbase Base Account connector, which needs optional peers we do not
    // install. We only ever use injected(), so stub the unreachable branch
    // rather than add dependencies for a code path that never executes.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/evm': false,
      '@coinbase/cdp-sdk': false,
    };
    return config;
  },
};

export default nextConfig;
