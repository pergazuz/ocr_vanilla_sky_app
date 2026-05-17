import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb', // Or any other appropriate size like '2mb', '10mb'
    },
  },
};

export default nextConfig;
