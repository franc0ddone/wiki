import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run verify:frontend` boots a throwaway dev server to assert that an
  // unauthenticated write is refused at the request boundary. It sets
  // `NEXT_DIST_DIR=.next-verify` so that server builds into its own directory
  // instead of fighting a `next dev` you already have running for the lock on
  // `.next`. Unset (the normal case), the build directory is Next's default.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
