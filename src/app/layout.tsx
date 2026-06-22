import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlayProof — Onchain Gameplay Data Marketplace for AI Training",
  description:
    "Gamers earn onchain rewards for contributing verified gameplay clips used to train gaming AI. Built on 0G Storage, 0G Compute, and 0G Chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
