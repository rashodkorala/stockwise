import type { Metadata } from "next";
import Link from "next/link";
import CommandBar from "@/components/CommandBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockwise",
  description: "Look through your ETFs to the companies you actually own.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            STOCKWISE
          </Link>
          <CommandBar />
          <nav className="nav">
            <Link href="/portfolio">PORT</Link>
            <Link href="/compare">OVLP</Link>
            <Link href="/">HELP</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
