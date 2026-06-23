/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The 0G SDK pulls in some node-targeted deps; keep them server-side only.
  experimental: {
    serverComponentsExternalPackages: ["@0gfoundation/0g-ts-sdk"],
  },
  webpack: (config) => {
    config.externals = config.externals || [];
    return config;
  },
};

export default nextConfig;
