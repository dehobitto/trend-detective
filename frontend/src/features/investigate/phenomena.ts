import type { BBox, Phenomenon } from '../../api/types';

/** The six multi-variable investigations, each a real-world phenomenon detectable from NASA data. */
export const PHENOMENA: Phenomenon[] = [
  {
    id: 'water_stress',
    name: 'Water Stress',
    tagline: 'Groundwater declines while rainfall stays stable',
    hypothesis: 'Groundwater declines while precipitation stays stable — evidence of human over-extraction.',
    description:
      'In regions of intensive irrigation, satellite gravity data (GRACE/GLDAS) reveal a falling water table even when rainfall is unchanged. If groundwater shows a significant decline but precipitation does not, the depletion is driven by pumping, not drought.',
    variables: [
      {
        variable_id: 'gldas_gws',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Groundwater storage — the direct indicator of aquifer depletion.',
      },
      {
        variable_id: 'gpm_precipitation',
        expect: 'not_significant',
        expect_label: 'Expect stable',
        role: 'Precipitation — control variable. If rain is stable, the decline is human-caused.',
      },
    ],
    global: false,
  },
  {
    id: 'urban_growth',
    name: 'Urban Growth',
    tagline: 'Nighttime lights expand, heat island grows, pollution rises',
    hypothesis: 'Nighttime lights increase, land surface temperature rises, and NO\u2082 grows — signatures of rapid urbanization.',
    description:
      'Cities leave multiple fingerprints in satellite data. As built-up area expands, nighttime lights intensify, the urban heat island grows (especially at night), and traffic-driven pollution (NO\u2082) rises. Seeing all four together confirms urbanization rather than a single anomaly.',
    variables: [
      {
        variable_id: 'viirs_night_lights',
        expect: 'significant_up',
        expect_label: 'Expect increase',
        role: 'Nighttime light radiance — a direct proxy for the extent of built-up area.',
      },
      {
        variable_id: 'modis_lst_day',
        expect: 'significant_up',
        expect_label: 'Expect warming',
        role: 'Daytime land surface temperature — concrete and asphalt absorb heat.',
      },
      {
        variable_id: 'modis_lst_night',
        expect: 'significant_up',
        expect_label: 'Expect warming',
        role: 'Nighttime land surface temperature — the urban heat island is strongest at night.',
      },
      {
        variable_id: 'omi_no2',
        expect: 'significant_up',
        expect_label: 'Expect increase',
        role: 'Tropospheric NO\u2082 — traffic and industry emit nitrogen dioxide.',
      },
    ],
    global: false,
  },
  {
    id: 'air_pollution',
    name: 'Air Pollution Cleanup',
    tagline: 'NO\u2082, SO\u2082, soot, and aerosols decline together',
    hypothesis: 'Multiple pollutants decline simultaneously — evidence of successful clean-air policies.',
    description:
      'When a government enforces emissions regulations, the fingerprint appears across several pollutants at once. NO\u2082 falls as traffic cleans up, SO\u2082 drops as coal plants install scrubbers, and soot and aerosol optical thickness follow. If all four decline together, it is policy, not weather.',
    variables: [
      {
        variable_id: 'omi_no2',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Tropospheric NO\u2082 — from vehicles and power plants, first to respond to regulations.',
      },
      {
        variable_id: 'merra2_so2',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Surface SO\u2082 — from coal combustion, regulated via scrubbers.',
      },
      {
        variable_id: 'merra2_bc',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Black carbon (soot) — from diesel and biomass burning.',
      },
      {
        variable_id: 'merra2_aod',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Total aerosol optical thickness — an overall haze indicator.',
      },
    ],
    global: false,
  },
  {
    id: 'deforestation',
    name: 'Deforestation',
    tagline: 'Vegetation index declines as forest is cleared',
    hypothesis: 'Vegetation index declines over time — evidence of forest loss.',
    description:
      'When tropical forest is cleared for agriculture or cattle ranching, the satellite-measured vegetation index (NDVI) drops. A significant downward trend in NDVI over a forested area is a direct signal of deforestation visible from space.',
    variables: [
      {
        variable_id: 'modis_ndvi',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Vegetation index (NDVI) — measures green leaf area; drops when forest is replaced.',
      },
    ],
    global: false,
  },
  {
    id: 'desertification',
    name: 'Desertification',
    tagline: 'Vegetation declines while rainfall stays stable',
    hypothesis: 'Vegetation declines while precipitation remains stable — evidence of land degradation, not drought.',
    description:
      'In transition zones between desert and savanna, population pressure drives overgrazing and overfarming. If vegetation declines but rainfall does not, the cause is human land use, not climate. Separating the two is the key analytical challenge, and the combination of both variables is the test.',
    variables: [
      {
        variable_id: 'modis_ndvi',
        expect: 'significant_down',
        expect_label: 'Expect decline',
        role: 'Vegetation index (NDVI) — drops as land degrades under pressure.',
      },
      {
        variable_id: 'gpm_precipitation',
        expect: 'not_significant',
        expect_label: 'Expect stable',
        role: 'Precipitation — control variable. Stable rain rules out drought as the cause.',
      },
    ],
    global: false,
  },
  {
    id: 'greenhouse_gases',
    name: 'Greenhouse Gas Rise',
    tagline: 'CO\u2082 and CH\u2084 climb year after year',
    hypothesis: 'Atmospheric CO\u2082 and CH\u2084 show steady upward trends driven by fossil fuels and agriculture.',
    description:
      'Greenhouse gases are well-mixed in the atmosphere, so a single time series tells the global story. CO\u2082 has risen at roughly 2 ppm per year for decades; methane accelerated after 2007. Seeing all three records rise together is the clearest signal of ongoing anthropogenic emissions.',
    variables: [
      {
        variable_id: 'mauna_loa_co2',
        expect: 'significant_up',
        expect_label: 'Expect rise',
        role: 'CO\u2082 at Mauna Loa — the longest continuous atmospheric CO\u2082 record (since 1958).',
      },
      {
        variable_id: 'noaa_co2_marine',
        expect: 'significant_up',
        expect_label: 'Expect rise',
        role: 'Global CO\u2082 (marine surface average) — confirms the trend is worldwide, not local.',
      },
      {
        variable_id: 'noaa_ch4_marine',
        expect: 'significant_up',
        expect_label: 'Expect rise',
        role: 'Global methane (CH\u2084) — the second most important greenhouse gas, accelerating after 2007.',
      },
    ],
    global: true,
  },
];

/**
 * Maps example case IDs → { phenomenon ID, region name, OSM relation ID }.
 * When an example in this map is selected, we switch to phenomenon mode for that region.
 * `osm` is used to fetch the real boundary via /api/regions/shape.
 */
export const EXAMPLE_PHENOMENON_MAP: Record<string, { phenomenonId: string; region: string; osm: string | null }> = {
  'punjab-groundwater': { phenomenonId: 'water_stress', region: 'Punjab, India',     osm: 'R1942478' },
  'punjab-rain':        { phenomenonId: 'water_stress', region: 'Punjab, India',     osm: 'R1942478' },
  'spain-groundwater':  { phenomenonId: 'water_stress', region: 'Andalusia, Spain',  osm: 'R349044' },
  'delhi-no2':          { phenomenonId: 'urban_growth', region: 'Delhi, India',      osm: 'R1942586' },
  'delhi-lights':       { phenomenonId: 'urban_growth', region: 'Delhi, India',      osm: 'R1942586' },
  'phoenix-nights':     { phenomenonId: 'urban_growth', region: 'Phoenix, USA',      osm: 'R111257' },
  'china-so2':          { phenomenonId: 'air_pollution', region: 'North China Plain', osm: null },
  'rondonia-forest':    { phenomenonId: 'deforestation', region: 'Rond\u00f4nia, Brazil', osm: 'R346990' },
  'sahel-green':        { phenomenonId: 'desertification', region: 'Sahel, Niger',   osm: null },
  'mauna-loa-co2':      { phenomenonId: 'greenhouse_gases', region: 'Global',        osm: null },
  'global-methane':     { phenomenonId: 'greenhouse_gases', region: 'Global',        osm: null },
};

/** Deduplicate example cases that share a phenomenon + region → one entry per investigation. */
export type PhenomenonExample = {
  phenomenonId: string;
  phenomenon: Phenomenon;
  region: string;
  /** OSM relation ID for fetching the real boundary, or null if none available. */
  osm: string | null;
  /** Representative example (first found). */
  example: { id: string; title: string; question: string; bbox: BBox | null; center: { lat: number; lon: number }; start: string; end: string; deseasonalize: boolean };
};

export function groupExamplesByPhenomenon(examples: { id: string; title: string; question: string; bbox: BBox | null; center: { lat: number; lon: number }; start: string; end: string; deseasonalize: boolean }[]): PhenomenonExample[] {
  const seen = new Set<string>();
  const groups: PhenomenonExample[] = [];
  for (const ex of examples) {
    const entry = EXAMPLE_PHENOMENON_MAP[ex.id];
    if (!entry) continue;
    // Deduplicate by phenomenonId + bbox (same phenomenon + same area = same investigation).
    const bboxKey = ex.bbox ? `${ex.bbox.west},${ex.bbox.south}` : 'global';
    const key = `${entry.phenomenonId}:${bboxKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ph = PHENOMENA.find((p) => p.id === entry.phenomenonId);
    if (!ph) continue;
    groups.push({ phenomenonId: entry.phenomenonId, phenomenon: ph, region: entry.region, osm: entry.osm, example: ex });
  }
  return groups;
}
