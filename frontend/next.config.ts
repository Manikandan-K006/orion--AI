import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    "10.201.160.25:3000",
    "10.201.160.25",
    "172.17.41.242:3000",
    "172.17.41.242",
    "*"
  ],

};

export default nextConfig;
