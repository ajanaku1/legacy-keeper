import type { Metadata } from 'next';
import { Manrope, DM_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LegacyKeeper — Continuity Plan',
  description:
    'Autonomous onchain inheritance and emergency evacuation, executed through KeeperHub.',
  icons: {
    icon: [
      {
        url: '/legacykeeper-mark.svg?v=split-shield-20260803',
        type: 'image/svg+xml',
      },
    ],
    shortcut: '/legacykeeper-mark.svg?v=split-shield-20260803',
    apple: '/legacykeeper-mark.png?v=split-shield-20260803',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body>
        <a className="skip-link" href="#evidence">Skip to execution record</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
