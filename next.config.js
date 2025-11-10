/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['socket.io', 'socket.io-client'],
}

module.exports = nextConfig
