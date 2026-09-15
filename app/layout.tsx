import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Andon",
  description: "Team status board — green, yellow, red.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-8 sm:px-8">
          <header className="mb-10 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="h-2 w-2 rounded-full bg-andon-green shadow-[0_0_10px_var(--green)]" />
                <span className="h-2 w-2 rounded-full bg-andon-yellow shadow-[0_0_10px_var(--yellow)]" />
                <span className="h-2 w-2 rounded-full bg-andon-red shadow-[0_0_10px_var(--red)]" />
              </span>
              <span className="text-sm font-semibold tracking-[0.22em] text-foreground uppercase">
                Andon
              </span>
            </Link>
            <p className="text-xs tracking-wide text-muted">Floor status</p>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
