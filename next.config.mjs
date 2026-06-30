/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // O type-check do TypeScript (strict) continua valendo no build.
    // Só o lint é ignorado no build para não bloquear o deploy por estilo.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
