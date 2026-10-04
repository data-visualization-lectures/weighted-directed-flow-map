(function (root) {
  'use strict';

  // Local copies of the catalog samples. Used as the fallback when catalog.json
  // is unreachable, and merged into <dataviz-sample-picker> so the samples show
  // up before the shared catalog lists them.

  const APP_NAME = 'weighted-directed-flow-map';

  const SAMPLE_ENTRIES = [
    {
      id: 'wdfm-jp-prefecture-migration-2025',
      files: { ja: 'samples/jp-prefecture-migration-2025.csv', en: 'samples/jp-prefecture-migration-2025.en.csv' },
      tableShape: 'matrix',
      name: '都道府県間の人口移動（2025年）',
      nameEn: 'Migration between prefectures of Japan (2025)',
      description: '移動前の住所地（行）から移動後の住所地（列）への移動者数。47×47 の OD 行列。',
      descriptionEn: 'Number of people who moved from the prefecture in each row to the prefecture in each column. A 47 × 47 origin-destination matrix.',
      tags: ['人口移動', 'OD', '都道府県'],
      tagsEn: ['Migration', 'Origin-destination', 'Prefectures'],
      rowCount: 47,
      dataAsOf: '2025年',
      unit: { ja: '人', en: 'people' },
      source: '総務省統計局「住民基本台帳人口移動報告 2025年結果」第2表を加工して作成',
      sourceEn: 'Statistics Bureau of Japan, Report on Internal Migration in Japan 2025, Table 2 (edited)',
      sourceUrl: 'https://www.e-stat.go.jp/stat-search/files?toukei=00200523&tstat=000000070001',
    },
    {
      id: 'wdfm-jp-trade-by-country-2021-2025',
      files: { ja: 'samples/jp-trade-by-country-2021-2025.csv', en: 'samples/jp-trade-by-country-2021-2025.en.csv' },
      tableShape: 'long',
      name: '日本と主要30か国・地域の輸出入（2021〜2025年）',
      nameEn: "Japan's exports and imports with 30 major partners (2021–2025)",
      description: '日本→相手国が輸出、相手国→日本が輸入。年別。2025年は確々報値。',
      descriptionEn: 'Japan → partner is exports, partner → Japan is imports, by year. 2025 figures are preliminary.',
      tags: ['貿易', '輸出入', '世界'],
      tagsEn: ['Trade', 'Exports and imports', 'World'],
      rowCount: 300,
      dataAsOf: '2021〜2025年',
      unit: { ja: '千円', en: 'thousand yen' },
      source: '財務省「貿易統計」輸出入額の推移（地域（国）別）を加工して作成',
      sourceEn: 'Ministry of Finance, Trade Statistics of Japan: value of exports and imports by country (edited)',
      sourceUrl: 'https://www.customs.go.jp/toukei/suii/html/time.htm',
    },
  ];

  function resolveFileUrl(rel) {
    try {
      return new URL(rel, location.href).href;
    } catch (_error) {
      return rel;
    }
  }

  function columnsOf(entry, lang) {
    if (entry.tableShape === 'matrix') return lang === 'en' ? ['Origin', '…'] : ['移動前の住所地', '…'];
    return lang === 'en' ? ['Year', 'From', 'To', 'Value (thousand yen)'] : ['年', '出発地', '到着地', '金額（千円）'];
  }

  function toPickerEntry(entry) {
    return {
      id: entry.id,
      name: entry.name,
      nameEn: entry.nameEn,
      description: entry.description,
      descriptionEn: entry.descriptionEn,
      format: 'csv',
      tableShape: entry.tableShape,
      tags: entry.tags,
      tagsEn: entry.tagsEn,
      columns: columnsOf(entry, 'ja'),
      columnsEn: columnsOf(entry, 'en'),
      rowCount: entry.rowCount,
      fileUrl: resolveFileUrl(entry.files.ja),
      fileUrlEn: resolveFileUrl(entry.files.en),
      thumbnailUrl: null,
      compatibleTools: [APP_NAME],
      category: 'tabular',
      dataAsOf: entry.dataAsOf || null,
      source: entry.source,
      sourceEn: entry.sourceEn,
      sourceUrl: entry.sourceUrl,
      extra: { valueUnit: entry.unit },
    };
  }

  function getLocalEntries() {
    return SAMPLE_ENTRIES.map(toPickerEntry);
  }

  function defaultEntry() {
    return SAMPLE_ENTRIES[0];
  }

  // Finds a local entry by catalog id or by file name (catalog URLs end with the same file name).
  function findLocal(idOrUrl) {
    const key = String(idOrUrl || '');
    return SAMPLE_ENTRIES.find((e) => e.id === key
      || key.endsWith(`/${e.files.ja.split('/').pop()}`)
      || key.endsWith(`/${e.files.en.split('/').pop()}`)) || null;
  }

  function annotationFor(entry, lang) {
    const en = lang === 'en';
    if (!entry) return { title: '', source: '', sourceUrl: '', unit: '' };
    return {
      title: '',
      source: en ? (entry.sourceEn || entry.source || '') : (entry.source || entry.sourceEn || ''),
      sourceUrl: entry.sourceUrl || '',
      unit: entry.unit ? entry.unit[en ? 'en' : 'ja'] : '',
    };
  }

  function mergeEntries(existing, extra) {
    const merged = [];
    const seen = new Set();
    (existing || []).concat(extra || []).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const key = entry.id || entry.fileUrl;
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(entry);
    });
    return merged;
  }

  function installPickerPatch() {
    if (root.__wdfmSamplePickerPatchInstalled) return;
    root.__wdfmSamplePickerPatchInstalled = true;

    const install = () => {
      const Picker = root.customElements && root.customElements.get && root.customElements.get('dataviz-sample-picker');
      if (!Picker || !Picker.prototype || Picker.prototype.__wdfmSamplePatchInstalled) return;
      const originalOpen = Picker.prototype.open;
      if (typeof originalOpen !== 'function') return;

      Picker.prototype.open = async function (...args) {
        const result = await originalOpen.apply(this, args);
        const toolId = this._toolId || APP_NAME;
        if (toolId !== APP_NAME) return result;
        this._entries = mergeEntries(this._entries || [], getLocalEntries())
          .filter((entry) => (entry.compatibleTools || []).some((token) => token === APP_NAME || String(token).startsWith(`${APP_NAME}/`)));
        this._filteredEntries = this._entries;
        if (typeof this._renderModal === 'function') this._renderModal();
        else if (typeof this._renderList === 'function') this._renderList();
        return result;
      };
      Picker.prototype.__wdfmSamplePatchInstalled = true;
    };

    install();
    if (root.customElements && typeof root.customElements.whenDefined === 'function') {
      root.customElements.whenDefined('dataviz-sample-picker').then(install).catch(() => {});
    }
  }

  root.FlowSampleCatalog = {
    APP_NAME,
    SAMPLE_ENTRIES,
    getLocalEntries,
    defaultEntry,
    findLocal,
    annotationFor,
    installPickerPatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
