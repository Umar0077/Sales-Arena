import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "FE Sales Arena — Live Final Expense Sales & Rewards",
  description: "FE Sales Arena: live Final Expense sales broadcast, leaderboard and 3D reward spinner.",
};

export const viewport: Viewport = {
  themeColor: "#070B16",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-background text-text-primary font-sans antialiased min-h-screen" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
