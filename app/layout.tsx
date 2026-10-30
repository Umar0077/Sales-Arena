import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

// Sora is a variable font, so one file covers every weight (100–800).
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FE Sales Arena — Live Final Expense Sales & Rewards",
  description: "FE Sales Arena: live Final Expense sales broadcast, leaderboard and 3D reward spinner."
};

export const viewport: Viewport = {
  themeColor: "#070B16",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sora.variable}`} suppressHydrationWarning>
      <body className="bg-background text-text-primary font-sans antialiased min-h-screen" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
