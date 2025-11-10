import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Garchy Bot',
  description: 'Real-time trading signals powered by VWAP and GARCH volatility analysis',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
