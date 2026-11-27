import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Audifox — Vietnamese Novel Audiobook',
  description: 'Auto-crawl Vietnamese web novels and listen as AI-narrated audiobooks with karaoke sync.',
  keywords: ['vietnamese novel', 'audiobook', 'text-to-speech', 'truyện audio', 'nghe truyện'],
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0E101A" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
