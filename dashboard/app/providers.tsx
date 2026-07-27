'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SEPOLIA_RPC_URL } from '@/lib/contract';

const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    // Falls back to a public endpoint so the dashboard still renders when no
    // private RPC is configured — reads are cheap and non-sensitive.
    [sepolia.id]: http(SEPOLIA_RPC_URL || undefined),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchInterval: 15_000, staleTime: 10_000 } },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
