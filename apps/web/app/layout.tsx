import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";
import { ConfirmRoot } from "@/components/ui/confirm-dialog";
import { CommandPalette } from "@/components/ui/command-palette";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "korepush — Self-hosted push-to-deploy PaaS on a server you own",
  description:
    "korepush is an open-source, self-hosted PaaS: the Vercel/Railway push-to-deploy workflow — auto-detected builds, live logs, managed Postgres and Redis, automatic HTTPS, one-click rollbacks — on a single Linux box you own. One command. No cloud bill, no lock-in.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
        <ConfirmRoot />
        <CommandPalette />
      </body>
    </html>
  );
}
