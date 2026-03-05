import type { Metadata } from 'next';
import './globals.css';
import { AppNav } from '@/components/AppNav';

export const metadata: Metadata = {
  title: 'Telegram Community Dashboard',
  description: 'Management dashboard for chat analytics, contacts and CRM',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppNav />
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
