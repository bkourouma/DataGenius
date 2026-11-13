/**
 * Briques communes du catalogue : libelles a six langues, regles de calcul partagees,
 * fabriques de filtres standards et petits utilitaires SQL.
 *
 * Un jeu les reference dans `regles` : elles remontent telles quelles dans la provenance.
 */

import { Prisma } from '@prisma/client'

import type { Locale } from '@/i18n/config'
import type { DefinitionFiltre, EntiteFiltre, Libelle } from './types'

/** Construit un libelle complet : fr, en, es, zh, ar, hi (dans cet ordre). */
export function lib(
  fr: string,
  en: string,
  es: string,
  zh: string,
  ar: string,
  hi: string
): Libelle {
  return { fr, en, es, zh, ar, hi }
}

/** Libelle dans la langue demandee, a defaut en francais. */
export function libelleDe(libelle: Libelle, locale: Locale): string {
  return libelle[locale] || libelle.fr
}

export const LANGUES: readonly Locale[] = ['fr', 'en', 'es', 'zh', 'ar', 'hi']

/** Vrai si les six langues sont renseignees (test de parite). */
export function libelleComplet(libelle: Libelle): boolean {
  return LANGUES.every(l => typeof libelle[l] === 'string' && libelle[l].trim().length > 0)
}

// ---------------------------------------------------------------------------
// Regles de calcul partagees (provenance)
// ---------------------------------------------------------------------------

export const REGLES = {
  ca: lib(
    'CA = quantité vendue × PGHT de la ligne de vente (prix figé à la saisie), en euros',
    'Revenue = quantity sold × PGHT of the sales line (price fixed at entry), in euros',
    'Facturación = cantidad vendida × PGHT de la línea de venta (precio fijado en la captura), en euros',
    '销售额 = 销售数量 × 该销售行的 PGHT（录入时固定的价格），单位为欧元',
    'رقم الأعمال = الكمية المباعة × سعر PGHT لسطر البيع (السعر المثبّت عند الإدخال)، باليورو',
    'राजस्व = बेची गई मात्रा × बिक्री पंक्ति का PGHT (प्रविष्टि के समय तय मूल्य), यूरो में'
  ),
  inactifs: lib(
    'Produits, grossistes et pays inactifs exclus',
    'Inactive products, wholesalers and countries excluded',
    'Productos, mayoristas y países inactivos excluidos',
    '不含已停用的产品、批发商和国家',
    'استبعاد المنتجات والموزعين والبلدان غير النشطة',
    'निष्क्रिय उत्पाद, थोक विक्रेता और देश शामिल नहीं हैं'
  ),
  dernierMoisClos: lib(
    'Sans période précisée : dernier mois complet (le mois qui précède le mois en cours)',
    'No period given: last complete month (the month before the current month)',
    'Sin período indicado: último mes completo (el mes anterior al mes en curso)',
    '未指定期间时：取最近一个完整的月份（当前月份的上一个月）',
    'عند عدم تحديد الفترة: آخر شهر كامل (الشهر السابق للشهر الحالي)',
    'अवधि न दी जाने पर: अंतिम पूरा महीना (चालू महीने से पहले का महीना)'
  ),
  exercice: lib(
    'Exercice d’avril à mars ; le budget reste saisi en année civile',
    'Fiscal year from April to March; the budget is still entered by calendar year',
    'Ejercicio de abril a marzo; el presupuesto sigue capturado por año civil',
    '财年为4月至次年3月；预算仍按自然年录入',
    'السنة المالية من أبريل إلى مارس؛ وتبقى الميزانية مُدخلة بالسنة الميلادية',
    'वित्त वर्ष अप्रैल से मार्च; बजट कैलेंडर वर्ष में दर्ज रहता है'
  ),
  stockInstantane: lib(
    'Le stock est un instantané d’un seul mois : les stocks de mois différents ne s’additionnent pas',
    'Stock is a one-month snapshot: stocks of different months are never added up',
    'El stock es una instantánea de un solo mes: los stocks de meses distintos no se suman',
    '库存是单一月份的快照：不同月份的库存不能相加',
    'المخزون لقطة لشهر واحد: لا تُجمع مخزونات أشهر مختلفة',
    'स्टॉक एक ही महीने का स्नैपशॉट है: अलग-अलग महीनों के स्टॉक जोड़े नहीं जाते'
  ),
  perimetre: lib(
    'Périmètre du lecteur appliqué : seuls les pays et agences autorisés sont comptés',
    'Reader’s scope applied: only authorised countries and agencies are counted',
    'Se aplica el perímetro del lector: solo se cuentan los países y agencias autorizados',
    '已应用读者的数据范围：仅统计其有权访问的国家和代理机构',
    'تم تطبيق نطاق القارئ: تُحتسب فقط البلدان والوكالات المصرّح بها',
    'पाठक का दायरा लागू: केवल अधिकृत देश और एजेंसियाँ गिनी जाती हैं'
  ),
  tauxRealisation: lib(
    'Taux de réalisation = somme des ventes ÷ somme du budget (jamais la moyenne de taux de lignes)',
    'Achievement rate = total sales ÷ total budget (never an average of line rates)',
    'Tasa de cumplimiento = suma de ventas ÷ suma del presupuesto (nunca el promedio de tasas)',
    '完成率 = 销售总额 ÷ 预算总额（绝不是各行完成率的平均值）',
    'نسبة التحقق = مجموع المبيعات ÷ مجموع الميزانية (وليس متوسط نسب الأسطر)',
    'उपलब्धि दर = कुल बिक्री ÷ कुल बजट (पंक्तियों की दरों का औसत कभी नहीं)'
  ),
  budgetCa: lib(
    'Budget en CA = quantité budgétée × PGHT en vigueur du pays et du produit ; à défaut, prix moyen constaté ; sinon 0',
    'Budget in revenue = budgeted quantity × current PGHT of the country and product; otherwise average observed price; otherwise 0',
    'Presupuesto en facturación = cantidad presupuestada × PGHT vigente del país y producto; si no, precio medio constatado; si no, 0',
    '预算销售额 = 预算数量 × 该国家与产品的现行 PGHT；无现行价则取实际平均价；否则为0',
    'الميزانية برقم الأعمال = الكمية المخططة × سعر PGHT الساري للبلد والمنتج؛ وإلا متوسط السعر المسجَّل؛ وإلا صفر',
    'राजस्व में बजट = बजट मात्रा × देश और उत्पाद का वर्तमान PGHT; अन्यथा औसत देखा गया मूल्य; अन्यथा 0'
  ),
  seuils: lib(
    'Seuils de réalisation : en dessous de 70 % critique, de 70 à 90 % en cours, à partir de 90 % atteint',
    'Achievement thresholds: below 70% critical, 70–90% in progress, 90% and above achieved',
    'Umbrales de cumplimiento: menos de 70 % crítico, de 70 a 90 % en curso, desde 90 % alcanzado',
    '完成率阈值：低于70%为严重，70%–90%为进行中，90%及以上为已达成',
    'عتبات التحقق: أقل من 70% حرج، من 70 إلى 90% قيد التنفيذ، 90% فأكثر محقق',
    'उपलब्धि सीमाएँ: 70% से नीचे गंभीर, 70–90% प्रगति में, 90% और ऊपर प्राप्त'
  ),
  devise: lib(
    'Montants en euros (EUR)',
    'Amounts in euros (EUR)',
    'Importes en euros (EUR)',
    '金额单位为欧元（EUR）',
    'المبالغ باليورو (EUR)',
    'राशियाँ यूरो (EUR) में'
  ),
  visasFiables: lib(
    'Visas fiables seulement : visas non supprimés, de qualité de données « complète »',
    'Reliable visas only: non-deleted visas with “complete” data quality',
    'Solo visados fiables: visados no eliminados con calidad de datos «completa»',
    '仅限可靠的许可证：未删除且数据质量为“完整”的许可证',
    'التأشيرات الموثوقة فقط: غير المحذوفة وذات جودة بيانات «كاملة»',
    'केवल विश्वसनीय वीज़ा: हटाए नहीं गए और डेटा गुणवत्ता «पूर्ण» वाले'
  ),
} as const

// ---------------------------------------------------------------------------
// Utilitaires SQL
// ---------------------------------------------------------------------------

/** Echappe % _ et \ pour un LIKE ... ESCAPE '\'. */
export function echapperLike(texte: string): string {
  return texte.replace(/[\\%_]/g, c => `\\${c}`)
}

const AVEC_ACCENTS = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸŒ'
const SANS_ACCENTS = 'aaaaaaceeeeiiiinooooouuuuyyoAAAAAACEEEEIIIINOOOOOUUUUYYO'

/** Normalise un terme de recherche cote JS : minuscules, sans accents, espaces compactes. */
export function normaliserRecherche(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Expression SQL qui rend `colonne` en minuscules et sans accents (l'extension unaccent
 * n'est pas installee). `colonne` vient du code, jamais de l'utilisateur.
 */
export function sqlSansAccents(colonne: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(colonne)) throw new Error(`Colonne SQL invalide : ${colonne}`)
  return Prisma.sql`lower(translate(${Prisma.raw(colonne)}::text, ${AVEC_ACCENTS}, ${SANS_ACCENTS}))`
}

/** Condition « contient » insensible a la casse et aux accents, sur une ou plusieurs colonnes. */
export function conditionRecherche(colonnes: string[], terme: string): Prisma.Sql {
  const motif = `%${echapperLike(normaliserRecherche(terme))}%`
  const conditions = colonnes.map(c => Prisma.sql`${sqlSansAccents(c)} LIKE ${motif} ESCAPE '\\'`)
  return Prisma.sql`(${Prisma.join(conditions, ' OR ')})`
}

// ---------------------------------------------------------------------------
// Fabriques de filtres standards
// ---------------------------------------------------------------------------

/** Filtre « identifiants » : `cle` (ex. 'paysIds') sur la colonne d'identifiant `colonne` (ex. 'pays_id'). */
export function filtreIds(
  cle: string,
  colonne: string,
  entite: EntiteFiltre,
  libelle: Libelle,
  definition: string
): DefinitionFiltre {
  if (!/^[a-z_][a-z0-9_]*$/i.test(colonne)) throw new Error(`Colonne SQL invalide : ${colonne}`)
  return {
    cle,
    libelle,
    definition,
    type: 'ids',
    entite,
    condition: valeur => Prisma.sql`${Prisma.raw(colonne)} IN (${Prisma.join(valeur as string[])})`,
  }
}

/** Filtre « liste de valeurs » (statuts...) sur une colonne texte. */
export function filtreListe(
  cle: string,
  colonne: string,
  valeursPossibles: string[] | undefined,
  libelle: Libelle,
  definition: string
): DefinitionFiltre {
  if (!/^[a-z_][a-z0-9_]*$/i.test(colonne)) throw new Error(`Colonne SQL invalide : ${colonne}`)
  return {
    cle,
    libelle,
    definition,
    type: 'liste',
    valeursPossibles,
    condition: valeur => Prisma.sql`${Prisma.raw(colonne)} IN (${Prisma.join(valeur as string[])})`,
  }
}

/** Filtre « recherche libre » : contient, sans casse ni accents, sur plusieurs colonnes texte. */
export function filtreRecherche(
  colonnes: string[],
  libelle: Libelle,
  definition: string
): DefinitionFiltre {
  return {
    cle: 'recherche',
    libelle,
    definition,
    type: 'texte',
    condition: valeur => conditionRecherche(colonnes, String(valeur)),
  }
}
