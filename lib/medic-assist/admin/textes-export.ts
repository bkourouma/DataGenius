/**
 * Textes du classeur Excel des usages, par langue de l'interface (fr, en, es, zh, ar, hi).
 * Petit objet local plutot que next-intl : le classeur est produit cote serveur, dans la
 * langue du contexte, et ses libelles ne vivent nulle part ailleurs.
 */

import type { Locale } from '@/i18n/config'

export interface TextesExportUsages {
  titre: string
  periode: (debut: string, fin: string) => string
  taux: (taux: number, source: string) => string
  sourceTauxConfig: string
  sourceTauxDefaut: string
  exporteLe: (date: Date) => string
  pagination: (page: string, total: string) => string
  total: string
  feuilles: {
    resume: string
    parJour: string
    parMois: string
    parUtilisateur: string
    parModele: string
    parMode: string
  }
  colonnes: {
    debut: string
    fin: string
    taux: string
    jour: string
    mois: string
    utilisateur: string
    fournisseur: string
    modele: string
    mode: string
    appels: string
    tokensEntree: string
    tokensSortie: string
    coutUsd: string
    coutEur: string
    tokensCacheLecture: string
    tokensCacheEcriture: string
  }
  modes: { standard: string; profond: string; rapide: string; transcription: string }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateHeure = (d: Date) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`

export const TEXTES_EXPORT_USAGES: Record<Locale, TextesExportUsages> = {
  fr: {
    titre: 'Medic Assist : usages et coûts',
    periode: (d, f) => `Période : du ${d} au ${f}`,
    taux: (t, s) => `Taux : 1 USD = ${t} EUR (${s})`,
    sourceTauxConfig: 'saisi par l’administrateur',
    sourceTauxDefaut: 'taux par défaut',
    exporteLe: d => `Exporté le ${dateHeure(d)}`,
    pagination: (p, t) => `Page ${p} sur ${t}`,
    total: 'Total',
    feuilles: {
      resume: 'Résumé',
      parJour: 'Par jour',
      parMois: 'Par mois',
      parUtilisateur: 'Par utilisateur',
      parModele: 'Par modèle',
      parMode: 'Par mode',
    },
    colonnes: {
      debut: 'Début',
      fin: 'Fin',
      taux: 'Taux EUR par USD',
      jour: 'Jour',
      mois: 'Mois',
      utilisateur: 'Utilisateur',
      fournisseur: 'Fournisseur',
      modele: 'Modèle',
      mode: 'Mode',
      appels: 'Requêtes',
      tokensEntree: 'Jetons en entrée',
      tokensSortie: 'Jetons en sortie',
      coutUsd: 'Coût (USD)',
      coutEur: 'Coût (EUR)',
      tokensCacheLecture: 'Jetons lus en cache',
      tokensCacheEcriture: 'Jetons écrits en cache',
    },
    modes: {
      standard: 'Standard',
      profond: 'Approfondi',
      rapide: 'Rapide',
      transcription: 'Dictée',
    },
  },
  en: {
    titre: 'Medic Assist: usage and costs',
    periode: (d, f) => `Period: ${d} to ${f}`,
    taux: (t, s) => `Rate: 1 USD = ${t} EUR (${s})`,
    sourceTauxConfig: 'set by the administrator',
    sourceTauxDefaut: 'default rate',
    exporteLe: d => `Exported on ${dateHeure(d)}`,
    pagination: (p, t) => `Page ${p} of ${t}`,
    total: 'Total',
    feuilles: {
      resume: 'Summary',
      parJour: 'By day',
      parMois: 'By month',
      parUtilisateur: 'By user',
      parModele: 'By model',
      parMode: 'By mode',
    },
    colonnes: {
      debut: 'Start',
      fin: 'End',
      taux: 'EUR per USD rate',
      jour: 'Day',
      mois: 'Month',
      utilisateur: 'User',
      fournisseur: 'Provider',
      modele: 'Model',
      mode: 'Mode',
      appels: 'Requests',
      tokensEntree: 'Input tokens',
      tokensSortie: 'Output tokens',
      coutUsd: 'Cost (USD)',
      coutEur: 'Cost (EUR)',
      tokensCacheLecture: 'Cache read tokens',
      tokensCacheEcriture: 'Cache write tokens',
    },
    modes: {
      standard: 'Standard',
      profond: 'Deep analysis',
      rapide: 'Fast',
      transcription: 'Dictation',
    },
  },
  es: {
    titre: 'Medic Assist: uso y costes',
    periode: (d, f) => `Periodo: del ${d} al ${f}`,
    taux: (t, s) => `Tasa: 1 USD = ${t} EUR (${s})`,
    sourceTauxConfig: 'indicada por el administrador',
    sourceTauxDefaut: 'tasa por defecto',
    exporteLe: d => `Exportado el ${dateHeure(d)}`,
    pagination: (p, t) => `Página ${p} de ${t}`,
    total: 'Total',
    feuilles: {
      resume: 'Resumen',
      parJour: 'Por día',
      parMois: 'Por mes',
      parUtilisateur: 'Por usuario',
      parModele: 'Por modelo',
      parMode: 'Por modo',
    },
    colonnes: {
      debut: 'Inicio',
      fin: 'Fin',
      taux: 'Tasa EUR por USD',
      jour: 'Día',
      mois: 'Mes',
      utilisateur: 'Usuario',
      fournisseur: 'Proveedor',
      modele: 'Modelo',
      mode: 'Modo',
      appels: 'Solicitudes',
      tokensEntree: 'Tokens de entrada',
      tokensSortie: 'Tokens de salida',
      coutUsd: 'Coste (USD)',
      coutEur: 'Coste (EUR)',
      tokensCacheLecture: 'Tokens leídos de caché',
      tokensCacheEcriture: 'Tokens escritos en caché',
    },
    modes: {
      standard: 'Estándar',
      profond: 'Profundo',
      rapide: 'Rápido',
      transcription: 'Dictado',
    },
  },
  zh: {
    titre: 'Medic Assist：使用量与费用',
    periode: (d, f) => `期间：${d} 至 ${f}`,
    taux: (t, s) => `汇率：1 美元 = ${t} 欧元（${s}）`,
    sourceTauxConfig: '由管理员设置',
    sourceTauxDefaut: '默认汇率',
    exporteLe: d => `导出时间：${dateHeure(d)}`,
    pagination: (p, t) => `第 ${p} 页，共 ${t} 页`,
    total: '合计',
    feuilles: {
      resume: '摘要',
      parJour: '按日',
      parMois: '按月',
      parUtilisateur: '按用户',
      parModele: '按模型',
      parMode: '按模式',
    },
    colonnes: {
      debut: '开始',
      fin: '结束',
      taux: '欧元兑美元汇率',
      jour: '日期',
      mois: '月份',
      utilisateur: '用户',
      fournisseur: '提供商',
      modele: '模型',
      mode: '模式',
      appels: '调用次数',
      tokensEntree: '输入令牌',
      tokensSortie: '输出令牌',
      coutUsd: '费用（美元）',
      coutEur: '费用（欧元）',
      tokensCacheLecture: '缓存读取令牌',
      tokensCacheEcriture: '缓存写入令牌',
    },
    modes: { standard: '标准', profond: '深入分析', rapide: '快速', transcription: '语音听写' },
  },
  ar: {
    titre: 'Medic Assist: الاستخدام والتكاليف',
    periode: (d, f) => `الفترة: من ${d} إلى ${f}`,
    taux: (t, s) => `سعر الصرف: 1 دولار = ${t} يورو (${s})`,
    sourceTauxConfig: 'حدده المسؤول',
    sourceTauxDefaut: 'السعر الافتراضي',
    exporteLe: d => `تاريخ التصدير: ${dateHeure(d)}`,
    pagination: (p, t) => `صفحة ${p} من ${t}`,
    total: 'الإجمالي',
    feuilles: {
      resume: 'الملخص',
      parJour: 'حسب اليوم',
      parMois: 'حسب الشهر',
      parUtilisateur: 'حسب المستخدم',
      parModele: 'حسب النموذج',
      parMode: 'حسب الوضع',
    },
    colonnes: {
      debut: 'البداية',
      fin: 'النهاية',
      taux: 'سعر اليورو مقابل الدولار',
      jour: 'اليوم',
      mois: 'الشهر',
      utilisateur: 'المستخدم',
      fournisseur: 'المزوّد',
      modele: 'النموذج',
      mode: 'الوضع',
      appels: 'عدد الطلبات',
      tokensEntree: 'رموز الإدخال',
      tokensSortie: 'رموز الإخراج',
      coutUsd: 'التكلفة (دولار)',
      coutEur: 'التكلفة (يورو)',
      tokensCacheLecture: 'رموز قراءة الذاكرة المؤقتة',
      tokensCacheEcriture: 'رموز كتابة الذاكرة المؤقتة',
    },
    modes: {
      standard: 'قياسي',
      profond: 'تحليل معمّق',
      rapide: 'سريع',
      transcription: 'الإملاء الصوتي',
    },
  },
  hi: {
    titre: 'Medic Assist: उपयोग और लागत',
    periode: (d, f) => `अवधि: ${d} से ${f} तक`,
    taux: (t, s) => `दर: 1 USD = ${t} EUR (${s})`,
    sourceTauxConfig: 'प्रशासक द्वारा निर्धारित',
    sourceTauxDefaut: 'डिफ़ॉल्ट दर',
    exporteLe: d => `निर्यात का समय: ${dateHeure(d)}`,
    pagination: (p, t) => `पृष्ठ ${p} / ${t}`,
    total: 'कुल',
    feuilles: {
      resume: 'सारांश',
      parJour: 'दिन के अनुसार',
      parMois: 'महीने के अनुसार',
      parUtilisateur: 'उपयोगकर्ता के अनुसार',
      parModele: 'मॉडल के अनुसार',
      parMode: 'मोड के अनुसार',
    },
    colonnes: {
      debut: 'आरंभ',
      fin: 'समाप्ति',
      taux: 'प्रति USD EUR दर',
      jour: 'दिन',
      mois: 'महीना',
      utilisateur: 'उपयोगकर्ता',
      fournisseur: 'प्रदाता',
      modele: 'मॉडल',
      mode: 'मोड',
      appels: 'कॉल',
      tokensEntree: 'इनपुट टोकन',
      tokensSortie: 'आउटपुट टोकन',
      coutUsd: 'लागत (USD)',
      coutEur: 'लागत (EUR)',
      tokensCacheLecture: 'कैश से पढ़े टोकन',
      tokensCacheEcriture: 'कैश में लिखे टोकन',
    },
    modes: {
      standard: 'मानक',
      profond: 'गहन विश्लेषण',
      rapide: 'तेज़',
      transcription: 'बोलकर लिखना',
    },
  },
}
