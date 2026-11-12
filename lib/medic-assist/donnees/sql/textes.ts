/**
 * Textes visibles de la provenance du SQL controle, dans les six langues de l'interface.
 */

import { lib } from '../catalogue/communs'

export const TEXTES_SQL = {
  source: lib(
    'Requête SQL contrôlée',
    'Controlled SQL query',
    'Consulta SQL controlada',
    '受控 SQL 查询',
    'استعلام SQL مضبوط',
    'नियंत्रित SQL क्वेरी'
  ),
  sur: lib('sur', 'on', 'sobre', '基于', 'على', 'पर'),
  lectureSeule: lib(
    'Requête en lecture seule, limitée aux vues autorisées du catalogue (périmètre du lecteur et exclusion des inactifs déjà appliqués), délai maximal 15 s',
    'Read-only query, limited to the catalogue’s authorised views (reader’s scope and exclusion of inactive items already applied), 15 s maximum',
    'Consulta de solo lectura, limitada a las vistas autorizadas del catálogo (perímetro del lector y exclusión de inactivos ya aplicados), 15 s como máximo',
    '只读查询，仅限目录中的授权视图（已应用读者范围并排除停用项），最长 15 秒',
    'استعلام للقراءة فقط، مقصور على العروض المصرّح بها في الكتالوج (نطاق القارئ واستبعاد غير النشط مطبّقان مسبقًا)، بحد أقصى 15 ثانية',
    'केवल पढ़ने वाली क्वेरी, कैटलॉग के अधिकृत दृश्यों तक सीमित (पाठक का दायरा और निष्क्रिय का बहिष्करण पहले से लागू), अधिकतम 15 सेकंड'
  ),
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
} as const
