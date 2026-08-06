import type { Metadata } from "next";
import { Manrope, DM_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import { Providers } from "./providers";
import "./globals.css";
import "./landing.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LegacyKeeper — Continuity Plan",
  description:
    "Autonomous onchain inheritance and emergency evacuation, executed through KeeperHub.",
  icons: {
    icon: [
      {
        url: "/legacykeeper-mark.svg?v=transparent-mark-20260805",
        type: "image/svg+xml",
      },
    ],
    shortcut: "/legacykeeper-mark.svg?v=transparent-mark-20260805",
    apple: "/legacykeeper-mark.png?v=transparent-mark-20260805",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialState = cookieToInitialState(
    wagmiConfig,
    (await headers()).get("cookie"),
  );

  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
