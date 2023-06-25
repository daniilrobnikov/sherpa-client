/** @type {import('next').NextConfig} */
// Export output if NODE_ENV is production

const nextConfig = {};

if (process.env.NODE_ENV === "production") {
  module.exports = {
    ...nextConfig,
    output: "export",
  };
} else {
  module.exports = nextConfig;
}
