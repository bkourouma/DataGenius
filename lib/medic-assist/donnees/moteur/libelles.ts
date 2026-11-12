/**
 * Textes visibles propres au moteur semantique (provenance, colonnes temporelles), dans les
 * six langues de l'interface. Les regles metier communes vivent dans `catalogue/communs.ts`.
 */

import { lib } from '../catalogue/communs'

export const TEXTES_MOTEUR = {
  tousLesPays: lib(
    'Tous les pays',
    'All countries',
    'Todos los países',
    '所有国家',
    'جميع البلدان',
    'सभी देश'
  ),
  aucunPays: lib(
    'Aucun pays autorisé',
    'No authorised country',
    'Ningún país autorizado',
    '无授权国家',
    'لا يوجد بلد مصرّح به',
    'कोई अधिकृत देश नहीं'
  ),
  horsPerimetre: lib(
    'hors périmètre ou introuvable',
    'out of scope or not found',
    'fuera del perímetro o no encontrado',
    '超出范围或未找到',
    'خارج النطاق أو غير موجود',
    'दायरे से बाहर या नहीं मिला'
  ),
  exercice: lib('exercice', 'fiscal year', 'ejercicio', '财年', 'السنة المالية', 'वित्त वर्ष'),
  oui: lib('oui', 'yes', 'sí', '是', 'نعم', 'हाँ'),
  non: lib('non', 'no', 'no', '否', 'لا', 'नहीं'),
  totauxSurEnsemble: lib(
    'Les totaux portent sur toutes les lignes retenues par les filtres, y compris celles qui ne sont pas affichées',
    'Totals cover every line matching the filters, including lines not displayed',
    'Los totales abarcan todas las líneas que cumplen los filtros, incluidas las no mostradas',
    '合计涵盖符合筛选条件的所有行，包括未显示的行',
    'تشمل المجاميع كل الأسطر المطابقة للمرشحات، بما فيها الأسطر غير المعروضة',
    'योग फ़िल्टर से मेल खाने वाली सभी पंक्तियों को शामिल करते हैं, जो दिखाई नहीं गईं वे भी'
  ),
  trimestreCivil: lib(
    'Trimestres civils : T1 = janvier à mars, T2 = avril à juin, T3 = juillet à septembre, T4 = octobre à décembre',
    'Calendar quarters: Q1 = January–March, Q2 = April–June, Q3 = July–September, Q4 = October–December',
    'Trimestres civiles: T1 = enero a marzo, T2 = abril a junio, T3 = julio a septiembre, T4 = octubre a diciembre',
    '自然季度：第1季度=1–3月，第2季度=4–6月，第3季度=7–9月，第4季度=10–12月',
    'الأرباع الميلادية: الربع 1 = يناير إلى مارس، الربع 2 = أبريل إلى يونيو، الربع 3 = يوليو إلى سبتمبر، الربع 4 = أكتوبر إلى ديسمبر',
    'कैलेंडर तिमाहियाँ: T1 = जनवरी–मार्च, T2 = अप्रैल–जून, T3 = जुलाई–सितंबर, T4 = अक्टूबर–दिसंबर'
  ),
  periode: lib('Période', 'Period', 'Período', '期间', 'الفترة', 'अवधि'),
  // Colonnes temporelles ajoutees par la granularite.
  colonneMois: lib('Mois', 'Month', 'Mes', '月份', 'الشهر', 'महीना'),
  colonneTrimestre: lib('Trimestre', 'Quarter', 'Trimestre', '季度', 'الربع', 'तिमाही'),
  colonneExercice: lib(
    'Exercice',
    'Fiscal year',
    'Ejercicio',
    '财年',
    'السنة المالية',
    'वित्त वर्ष'
  ),
  colonneAnnee: lib('Année', 'Year', 'Año', '年份', 'السنة', 'वर्ष'),
} as const
