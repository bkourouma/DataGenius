const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')

const CHEMINS_AVEC_ENTETES_PROPRES = ['api/v1/integration/tableau', 'integration/autoriser']

function entetesTransversaux() {
  const entetes = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  ]
  if ((process.env.NEXTAUTH_URL ?? '').startsWith('https://')) {
    entetes.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' })
  }
  return entetes
}

module.exports = withNextIntl({
  reactStrictMode: true,
  output: 'standalone',
  // Anciennes adresses de l'assistant (les routes /api/medic-assist/** restent inchangées).
  // Next.js conserve la requête (?c=...) lors d'une redirection.
  async redirects() {
    return [
      { source: '/medic-assist', destination: '/assistant', permanent: true },
      { source: '/medic-assist/:path*', destination: '/assistant/:path*', permanent: true },
      { source: '/dashboard/admin/medic-assist', destination: '/dashboard/admin/assistant', permanent: true },
      { source: '/dashboard/admin/medic-assist/:path*', destination: '/dashboard/admin/assistant/:path*', permanent: true },
    ]
  },
  async headers() {
    const transversaux = entetesTransversaux()
    return [
      {
        source: `/((?!${CHEMINS_AVEC_ENTETES_PROPRES.join('|')}).*)`,
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          ...transversaux,
        ],
      },
      {
        source: '/integration/autoriser',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          ...transversaux,
        ],
      },
      // La route pose elle-même son CSP (frame-ancestors dynamique) et son Referrer-Policy.
      { source: '/api/v1/integration/tableau', headers: transversaux },
    ]
  },
  experimental: {
    instrumentationHook: true,
    serverActions: { bodySizeLimit: '6mb' },
    serverComponentsExternalPackages: ['@prisma/client', 'echarts', 'exceljs', 'mysql2', 'pdfmake', 'pptxgenjs', 'unpdf'],
    outputFileTracingIncludes: {
      '/*': ['./node_modules/pdfmake/fonts/Roboto/*'],
    },
  },
})
