import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ScoutAuthProvider } from "@/components/auth/ScoutAuth";
import { CurrencyProvider } from "@/components/Currency";
import { THEME_SCRIPT, ThemeProvider } from "@/components/Theme";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Scout: AI can reason. Scout helps it see.",
  description:
    "AI agents post USDC micro-bounties for real-world questions. Humans answer, a verifier checks consensus, and payouts settle on Celo.",
};

export const viewport: Viewport = {
  themeColor: "#FBFAF7",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="grain flex min-h-full flex-col bg-obsidian text-ivory">
        <ThemeProvider>
        <ScoutAuthProvider>
          <CurrencyProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ivory focus:px-4 focus:py-2 focus:text-obsidian"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
          </CurrencyProvider>
        </ScoutAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
