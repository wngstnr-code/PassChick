import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Web3Provider } from "~/components/web3/Web3Provider";
import { WalletProvider } from "~/components/web3/WalletProvider";

export const metadata: Metadata = {
  title: "Pass Chick | Celo Mainnet",
  description: "Pass Chick game with fixed-stake paid runs on Celo.",
  other: {
    "talentapp:project_verification":
      "1e9ca83c2b5b363dc890ad9caf2a30688a2a2988338135257e7881b2c3f5822ba0c4311ed792540dc971ba6d6f3d52ef2fe3f2c9966bf1f1e5f99208a787499f",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>
          <WalletProvider>{children}</WalletProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
