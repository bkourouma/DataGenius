const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')

module.exports = withNextIntl({
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'echarts', 'exceljs', 'pdfmake', 'pptxgenjs', 'unpdf'],
  },
})
