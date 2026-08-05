/**
 * Attribution contract for every file derived from the AIJ pedestrian-wind benchmark data.
 *
 * AIJ's CFD benchmark working group agreed (correspondence with Prof. Hideki Kikumoto,
 * August 2026) to this repository redistributing files derived from their published
 * wind-tunnel data on three conditions, all of which are encoded here rather than left to
 * prose in NOTICE:
 *
 *   1. users cite the data paper AND the original publications for the individual case;
 *   2. it is stated plainly that the derived files were created and processed
 *      independently for AeroFlow and that AIJ does not warrant them;
 *   3. the derived files retain source, download date and the processing applied.
 *
 * Conditions 1 and 2 live in this module; condition 3 is the `source`/`geometry`
 * provenance already required by the Case A and Case C/E fixture loaders, plus the
 * `processing` field below. A fixture that drops any of them fails to load — an
 * unattributed benchmark file must never reach a published score.
 */

/**
 * The data paper for the AIJ Urban Wind Environment benchmark cases. Every consumer of
 * any case cites this; per-case experiment papers are additional, not alternatives.
 */
export const AIJ_DATA_PAPER =
  'Kikumoto, H., Okaze, T., Yoshie, R., Tachibana, T., Ishihara, T., Nonomura, Y., ' +
  'Kiyota, N., Kondo, H., Mochida, A. & Tominaga, Y. (2026), "Comprehensive Experimental ' +
  'Database for Validating CFD Simulations in Urban Wind Environment: Benchmark Cases ' +
  'Curated by the Architectural Institute of Japan", Japan Architectural Review 9(1), ' +
  'e70083. https://doi.org/10.1002/2475-8876.70083';

/**
 * AIJ's LES guideline: the reference for implementing and evaluating these benchmark
 * cases with large-eddy simulation, which is what AeroFlow's solver is. AIJ asked
 * specifically that it be consulted alongside Tominaga et al. (2008).
 */
export const AIJ_LES_GUIDELINE =
  'Okaze, T., Kikumoto, H., Ikegaya, N., Nakao, K., Ono, H., Nakajima, K., Imano, M., ' +
  'Hasama, T., Tabata, Y., Kishida, T., Yoshie, R. & Tominaga, Y. (2026), "AIJ guidelines ' +
  'on the applications of large-eddy simulation to pedestrian wind environment: ' +
  'Recommendations and validation benchmarks", J. Wind Eng. Ind. Aerodyn. 269, 106321. ' +
  'https://doi.org/10.1016/j.jweia.2025.106321';

/**
 * The wording AIJ asked for, verbatim. Fixtures must carry it unmodified — the loader
 * compares against this constant so a derived file cannot quietly soften or drop it.
 */
export const AIJ_DISCLAIMER =
  'These derived files were created and processed independently for AeroFlow. The ' +
  'Architectural Institute of Japan (AIJ) does not guarantee their quality, accuracy, ' +
  'completeness, or suitability for any particular purpose.';

/** An openly republished AIJ dataset of record (Zenodo, CC BY 4.0). */
export interface AijDatasetOfRecord {
  title: string;
  doi: string;
  license: string;
}

export interface AijAttribution {
  /** The data paper; must be {@link AIJ_DATA_PAPER}. */
  dataPaper: string;
  /**
   * Original publication(s) describing this case's experiment, as referenced by the data
   * paper. At least one is required: "cite the data paper" alone does not satisfy AIJ.
   */
  caseSources: string[];
  /** AIJ's own open republication of this case's measurements, when one exists. */
  dataset?: AijDatasetOfRecord;
  /** Guidance for implementing/evaluating the case; carries {@link AIJ_LES_GUIDELINE}. */
  implementationGuidance?: string[];
  /** What this repository did to the source data to produce the derived file. */
  processing: string;
  /** AIJ's required disclaimer; must be {@link AIJ_DISCLAIMER}. */
  disclaimer: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate the attribution block of a derived AIJ file.
 *
 * `context` names the fixture in the error so a failure points at the file to fix.
 */
export function validateAijAttribution(
  value: unknown,
  context: string,
): asserts value is AijAttribution {
  if (!isObject(value)) {
    throw new Error(`${context}: missing attribution block (AIJ redistribution condition)`);
  }
  if (value.dataPaper !== AIJ_DATA_PAPER) {
    throw new Error(`${context}: attribution.dataPaper must cite the AIJ data paper verbatim`);
  }
  if (
    !Array.isArray(value.caseSources) ||
    value.caseSources.length === 0 ||
    !value.caseSources.every(isNonEmptyString)
  ) {
    throw new Error(`${context}: attribution.caseSources must cite this case's experiment`);
  }
  if (value.dataset !== undefined) {
    const dataset = value.dataset;
    if (
      !isObject(dataset) ||
      !isNonEmptyString(dataset.title) ||
      !isNonEmptyString(dataset.doi) ||
      !isNonEmptyString(dataset.license)
    ) {
      throw new Error(`${context}: attribution.dataset needs a title, DOI and license`);
    }
  }
  if (
    value.implementationGuidance !== undefined &&
    (!Array.isArray(value.implementationGuidance) ||
      !value.implementationGuidance.every(isNonEmptyString))
  ) {
    throw new Error(`${context}: attribution.implementationGuidance must be non-empty strings`);
  }
  if (!isNonEmptyString(value.processing)) {
    throw new Error(`${context}: attribution.processing must state how the file was derived`);
  }
  if (value.disclaimer !== AIJ_DISCLAIMER) {
    throw new Error(`${context}: attribution.disclaimer must carry AIJ's wording verbatim`);
  }
}

/** One-line citation summary for UI footers and console output. */
export function formatAijCitation(attribution: AijAttribution): string {
  return [AIJ_DATA_PAPER, ...attribution.caseSources].join(' | ');
}
