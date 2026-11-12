const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')

module.exports = withNextIntl({
  reactStrictMode: true,
  async headers() {
    return [{ source: '/integration/autoriser', headers: [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }]
  },
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
    serverComponentsExternalPackages: ['@prisma/client', 'echarts', 'exceljs', 'mysql2', 'pdfmake', 'pptxgenjs', 'unpdf'],
  },
})
