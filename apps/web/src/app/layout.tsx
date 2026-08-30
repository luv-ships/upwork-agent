import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BidWork.app",
    template: "%s · BidWork.app"
  },
  description:
    "BidWork helps freelancers and agencies find better Upwork opportunities, draft tailored proposals, and stay in control."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
