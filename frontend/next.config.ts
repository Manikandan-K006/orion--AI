import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    "10.201.160.73:3000",
    "10.201.160.73",
    "10.201.160.13:3000",
    "10.201.160.13",
    "10.201.160.25:3000",
    "10.201.160.25",
    "172.17.41.242:3000",
    "172.17.41.242",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
