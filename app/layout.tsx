import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VWAP + GARCH Grid Trading Dashboard',
  description: 'Production-grade trading dashboard with VWAP and GARCH volatility',
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
