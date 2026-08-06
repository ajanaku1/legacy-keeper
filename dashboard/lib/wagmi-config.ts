import {
  cookieStorage,
  createConfig,
  createStorage,
  http,
  injected,
} from "wagmi";
import { SEPOLIA_RPC_URL } from "./contract";
import { sepolia } from "./sepolia";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC_URL || undefined),
  },
  ssr: true,
});
