import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Telegram Community Dashboard',
  description: 'Management dashboard for Main Chat analytics and CRM',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <a href="/" className="nav-logo">Telegram Dashboard</a>
            <div className="nav-links">
              <a href="/">Dashboard</a>
              <a href="/import">Import</a>
              <a href="/contacts">Contacts</a>
            </div>
          </div>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
