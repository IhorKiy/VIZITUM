import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";

import "./globals.css";

import { ErrorMonitor } from "../components/error-monitor";

export const metadata: Metadata = {
  title: "Vizitum",
  description: "Team pilot field operations workspace",
  icons: {
    // SVG first (crisp at any size), PNG for browsers that skip SVG
    // favicons; apple-touch-icon is what iOS actually reads for the
    // home-screen tile - it ignores the manifest's icons entirely.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, timeZone] = await Promise.all([
    getLocale(),
    getMessages(),
    getTimeZone(),
  ]);

  return (
    <html lang={locale}>
      <body>
        <ErrorMonitor />
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          now={new Date()}
          timeZone={timeZone}
        >
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
