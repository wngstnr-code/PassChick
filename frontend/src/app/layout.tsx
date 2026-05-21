import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppProviders } from "~/providers/AppProviders";

const APP_URL = "https://passchick.vercel.app";
const APP_NAME = "PASSCHICK";
const APP_DESCRIPTION =
  "A high-performance, skill-based survival arena on Celo. Verifiable arcade gameplay featuring \"Proof of Survival\" and real-time on-chain reputation.";
const APP_IMAGE = `${APP_URL}/images/1.webp`;
const APP_ICON = "/favicon.png";
const APP_SPLASH_BG = "#0a1428";

const miniAppEmbed = {
  version: "next",
  image: APP_IMAGE,
  imageUrl: APP_IMAGE,
  homeUrl: APP_URL,
  framesUrl: APP_URL,
  name: APP_NAME,
  iconUrl: APP_ICON,
  splashImageUrl: APP_ICON,
  splashBackgroundColor: APP_SPLASH_BG,
  buttonTitle: "Play PASSCHICK",
  action: {
    title: "Play PASSCHICK",
    action: {
      type: "launch_miniapp",
      name: APP_NAME,
      url: APP_URL,
      splashImageUrl: APP_ICON,
      splashBackgroundColor: APP_SPLASH_BG,
    },
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: `${APP_NAME}`,
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: APP_URL,
    siteName: APP_NAME,
    type: "website",
    images: [
      {
        url: APP_IMAGE,
        width: 1200,
        height: 630,
        alt: APP_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: [APP_IMAGE],
  },
  icons: {
    icon: APP_ICON,
    apple: APP_ICON,
  },
  other: {
    "talentapp:project_verification":
      "1e9ca83c2b5b363dc890ad9caf2a30688a2a2988338135257e7881b2c3f5822ba0c4311ed792540dc971ba6d6f3d52ef2fe3f2c9966bf1f1e5f99208a787499f",
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(miniAppEmbed),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

// celo: today safe dev index 2004

// celo: today safe dev index 2006

// celo: today safe dev index 2009

// celo: today safe dev index 2014

// celo: today safe dev index 2021

// celo: today safe dev index 2024

// celo: today safe dev index 2026

// celo: today safe dev index 2028

// celo: today safe dev index 2029

// celo: today safe dev index 2030

// celo: today safe dev index 2037

// celo: today safe dev index 2044
