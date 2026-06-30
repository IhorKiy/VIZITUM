import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vizitum",
  description: "Team pilot field operations workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
