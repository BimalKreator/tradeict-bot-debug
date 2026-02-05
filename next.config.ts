import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "binance.com", port: "", pathname: "/**" },
      { protocol: "https", hostname: "bybit.com", port: "", pathname: "/**" },
    ],
  },
};

export default nextConfig;
