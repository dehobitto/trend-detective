/**
 * Synthetic catalog for the in-browser mock only. The UI never hardcodes variables:
 * it always renders whatever GET /api/variables returns (this list stands in for it offline).
 */
import type { ExampleCase, Variable } from './types';

export type MockVariable = Variable & {
  /** Baseline value as a function of latitude. */
  base: (lat: number) => number;
  /** Seasonal amplitude at the given latitude. */
  amp: (lat: number) => number;
  /** Typical trend per decade (sign/magnitude modulated by region unless fixedTrend). */
  trend: number;
  noise: number;
  min?: number;
  /** Use `trend` exactly, everywhere (global records, strong signals). */
  fixedTrend?: boolean;
};

const END = '2024-12-31';
const v = (x: Omit<MockVariable, 'location'> & { location?: Variable['location'] }): MockVariable => ({ location: null, ...x });

const merra2Aer = (id: string, name: string, def: string, base: number, trend: number): MockVariable =>
  v({
    id, name, units: 'µg/m³', sphere: 'atmosphere', short_definition: def,
    why_it_matters: 'Fine particles in the air we breathe affect health, clouds and climate.',
    source: 'MERRA-2 (model reanalysis)', mission_or_model: 'MERRA-2', product: `M2TMNXAER.5.12.4:${id.toUpperCase()}`,
    dataset: 'M2TMNXAER v5.12.4', access: 'Giovanni', temporal_resolution: 'monthly',
    available_start: '1980-01-01', available_end: END, coverage: 'global',
    base: () => base, amp: () => base * 0.35, trend, noise: base * 0.18, min: 0,
  });

export const MOCK_VARIABLES: MockVariable[] = [
  v({
    id: 'gldas_groundwater', name: 'Groundwater storage', units: 'mm', sphere: 'water',
    short_definition: 'How much water is stored underground in aquifers, expressed as a depth of water.',
    why_it_matters: 'Aquifers supply drinking water and irrigation; once drained they refill very slowly.',
    source: 'GLDAS Catchment model (with GRACE data assimilation)', mission_or_model: 'GLDAS', product: 'GLDAS_CLSM025_DA1_D.2.2:GWS_tavg',
    dataset: 'GLDAS_CLSM025_DA1_D v2.2', access: 'Giovanni', temporal_resolution: 'daily',
    available_start: '2003-02-01', available_end: END, coverage: 'land',
    base: () => 900, amp: () => 25, trend: -45, noise: 12, min: 0,
  }),
  v({
    id: 'gldas_tws', name: 'Total water storage', units: 'mm', sphere: 'water',
    short_definition: 'All the water on and under the land: soil moisture, groundwater, snow and water in plants.',
    why_it_matters: 'Shows whether a region is gaining or losing water overall.',
    source: 'GLDAS Catchment model (with GRACE data assimilation)', mission_or_model: 'GLDAS', product: 'GLDAS_CLSM025_DA1_D.2.2:TWS_tavg',
    dataset: 'GLDAS_CLSM025_DA1_D v2.2', access: 'Giovanni', temporal_resolution: 'daily',
    available_start: '2003-02-01', available_end: END, coverage: 'land',
    base: () => 1200, amp: () => 60, trend: -30, noise: 15, min: 0,
  }),
  v({
    id: 'gpm_precipitation', name: 'Precipitation', units: 'mm/day', sphere: 'water',
    short_definition: 'How much rain and snow falls, as an average depth of water per day.',
    why_it_matters: 'Shifts in rainfall drive floods, droughts and water supply.',
    source: 'GPM IMERG (multi-satellite)', mission_or_model: 'GPM', product: 'GPM_3IMERGM.07:precipitation',
    dataset: 'GPM_3IMERGM v07', access: 'Giovanni', temporal_resolution: 'monthly',
    available_start: '2000-06-01', available_end: END, coverage: 'global',
    base: (lat) => Math.max(0.6, 6 - 0.1 * Math.abs(lat)), amp: (lat) => 1 + 2 * Math.cos((lat * Math.PI) / 180), trend: -0.03, noise: 0.9, min: 0,
  }),
  v({
    id: 'omi_no2_trop', name: 'Tropospheric nitrogen dioxide', units: '10¹⁵ molecules/cm²', sphere: 'atmosphere',
    short_definition: 'NO₂ in the lowest layer of the air, released mostly by traffic, power plants and industry.',
    why_it_matters: 'NO₂ is a marker of combustion pollution and harms lungs.',
    source: 'OMI on NASA’s Aura satellite', mission_or_model: 'OMI', product: 'OMNO2d.003:ColumnAmountNO2TropCloudScreened',
    dataset: 'OMNO2d v003', access: 'Giovanni', temporal_resolution: 'daily',
    available_start: '2004-10-01', available_end: END, coverage: 'global',
    base: () => 3.2, amp: () => 1.1, trend: 0.5, noise: 0.5, min: 0.1,
  }),
  v({
    id: 'modis_lst_day', name: 'Land surface temperature (day)', units: '°C', sphere: 'land',
    short_definition: 'How hot the ground itself is in the early afternoon, as seen from orbit. It runs hotter than the air.',
    why_it_matters: 'Hot surfaces signal urban heat islands and drying land.',
    source: 'MODIS on NASA’s Terra satellite', mission_or_model: 'MODIS', product: 'MOD11C3.061:LST_Day_CMG',
    dataset: 'MOD11C3 v061', access: 'AppEEARS', temporal_resolution: 'monthly',
    available_start: '2000-03-01', available_end: END, coverage: 'land',
    base: (lat) => 33 - 0.55 * Math.abs(lat), amp: (lat) => 1 + 0.32 * Math.abs(lat), trend: 0.3, noise: 0.9,
  }),
  v({
    id: 'modis_lst_night', name: 'Land surface temperature (night)', units: '°C', sphere: 'land',
    short_definition: 'How warm the ground stays late at night. Cities and humid air keep nights warmer.',
    why_it_matters: 'Warm nights give people and crops no chance to cool down.',
    source: 'MODIS on NASA’s Terra satellite', mission_or_model: 'MODIS', product: 'MOD11C3.061:LST_Night_CMG',
    dataset: 'MOD11C3 v061', access: 'AppEEARS', temporal_resolution: 'monthly',
    available_start: '2000-03-01', available_end: END, coverage: 'land',
    base: (lat) => 20 - 0.5 * Math.abs(lat), amp: (lat) => 1 + 0.28 * Math.abs(lat), trend: 0.35, noise: 0.7,
  }),
  merra2Aer('merra2_dust', 'Dust', 'Mineral dust lifted from deserts and dry soils, measured near the surface.', 60, -2),
  merra2Aer('merra2_bc', 'Black carbon', 'Soot from burning diesel, wood, coal and crop waste.', 1.2, 0.08),
  merra2Aer('merra2_oc', 'Organic carbon', 'Carbon-rich particles from fires, plants and burning fuels.', 4, 0.2),
  merra2Aer('merra2_so2', 'Sulfur dioxide', 'A gas from burning coal and oil, and from volcanoes, that turns into sulfate particles.', 6, -0.8),
  merra2Aer('merra2_so4', 'Sulfate', 'Tiny particles formed from sulfur dioxide. They make haze and reflect sunlight.', 5, -0.5),
  v({
    id: 'merra2_aot', name: 'Aerosol optical thickness', units: 'unitless', sphere: 'atmosphere',
    short_definition: 'How much sunlight all the particles in the air block together. 0 is perfectly clear; above 1 is very hazy.',
    why_it_matters: 'Haze affects air quality, health and how much sunlight reaches the ground.',
    source: 'MERRA-2 (model reanalysis)', mission_or_model: 'MERRA-2', product: 'M2TMNXAER.5.12.4:TOTEXTTAU',
    dataset: 'M2TMNXAER v5.12.4', access: 'Giovanni', temporal_resolution: 'monthly',
    available_start: '1980-01-01', available_end: END, coverage: 'global',
    base: () => 0.3, amp: () => 0.1, trend: 0.02, noise: 0.04, min: 0.01,
  }),
  v({
    id: 'merra2_so4_aot', name: 'Sulfate optical thickness', units: 'unitless', sphere: 'atmosphere',
    short_definition: 'The part of the haze caused by sulfate particles alone.',
    why_it_matters: 'Sulfate tracks coal burning and has fallen where scrubbers were installed.',
    source: 'MERRA-2 (model reanalysis)', mission_or_model: 'MERRA-2', product: 'M2TMNXAER.5.12.4:SUEXTTAU',
    dataset: 'M2TMNXAER v5.12.4', access: 'Giovanni', temporal_resolution: 'monthly',
    available_start: '1980-01-01', available_end: END, coverage: 'global',
    base: () => 0.1, amp: () => 0.03, trend: -0.008, noise: 0.012, min: 0,
  }),
  v({
    id: 'mlo_co2', name: 'Carbon dioxide at Mauna Loa', units: 'ppm', sphere: 'atmosphere',
    short_definition: 'CO₂ measured in clean mountain air on Hawaii since 1958: the famous Keeling Curve.',
    why_it_matters: 'CO₂ is the main gas driving global warming.',
    source: 'NOAA Global Monitoring Laboratory (station)', mission_or_model: 'NOAA GML', product: 'co2_mm_mlo',
    dataset: 'NOAA GML Mauna Loa monthly mean', access: 'KNMI Climate Explorer', temporal_resolution: 'monthly',
    available_start: '1958-03-01', available_end: END, coverage: 'series',
    location: { lat: 19.536, lon: -155.576, label: 'Mauna Loa Observatory, Hawaii' },
    base: () => 315, amp: () => 3.2, trend: 18, noise: 0.25, fixedTrend: true,
  }),
  v({
    id: 'noaa_co2_global', name: 'Global carbon dioxide', units: 'ppm', sphere: 'atmosphere',
    short_definition: 'The average CO₂ in the air over the whole planet, from a worldwide network of sampling sites.',
    why_it_matters: 'CO₂ is the main gas driving global warming.',
    source: 'NOAA Global Monitoring Laboratory (global marine mean)', mission_or_model: 'NOAA GML', product: 'co2_mm_gl',
    dataset: 'NOAA GML global marine surface mean', access: 'KNMI Climate Explorer', temporal_resolution: 'monthly',
    available_start: '1979-01-01', available_end: END, coverage: 'series',
    base: () => 337, amp: () => 1.2, trend: 19, noise: 0.15, fixedTrend: true,
  }),
  v({
    id: 'noaa_ch4_global', name: 'Global methane', units: 'ppb', sphere: 'atmosphere',
    short_definition: 'The average methane in the air worldwide. Methane comes from wetlands, cattle, rice fields and gas leaks.',
    why_it_matters: 'Methane traps far more heat than CO₂ per molecule.',
    source: 'NOAA Global Monitoring Laboratory (global marine mean)', mission_or_model: 'NOAA GML', product: 'ch4_mm_gl',
    dataset: 'NOAA GML global marine surface mean', access: 'KNMI Climate Explorer', temporal_resolution: 'monthly',
    available_start: '1983-07-01', available_end: END, coverage: 'series',
    base: () => 1640, amp: () => 9, trend: 55, noise: 3, fixedTrend: true,
  }),
];

export const MOCK_EXAMPLES: ExampleCase[] = [
  {
    id: 'nw-india-groundwater', title: 'Where is India’s groundwater going?',
    question: 'Is groundwater under northwest India falling, and is less rain to blame?',
    bbox: { west: 72, south: 26, east: 78, north: 32 }, variable_id: 'gldas_groundwater',
    start: '2003-01-01', end: '2023-12-31', deseasonalize: true, center: { lat: 29, lon: 75 },
    related_variable_id: 'gpm_precipitation',
    takeaway: 'Groundwater falls significantly while rainfall shows no significant trend, so the loss points to pumping for irrigation, not a drier climate.',
  },
  {
    id: 'delhi-no2', title: 'Is Delhi’s air getting dirtier?', question: 'Has traffic and industry pollution (NO₂) over Delhi risen since 2005?',
    bbox: { west: 76.8, south: 28.3, east: 77.6, north: 28.9 }, variable_id: 'omi_no2_trop',
    start: '2005-01-01', end: '2023-12-31', deseasonalize: true, center: { lat: 28.6, lon: 77.2 },
    related_variable_id: null, takeaway: null,
  },
  {
    id: 'sahara-dust', title: 'Is the Sahara less dusty?', question: 'Has the amount of dust over the western Sahara changed?',
    bbox: { west: -10, south: 15, east: 10, north: 28 }, variable_id: 'merra2_dust',
    start: '1990-01-01', end: '2023-12-31', deseasonalize: true, center: { lat: 21, lon: 0 },
    related_variable_id: null, takeaway: null,
  },
  {
    id: 'mauna-loa-co2', title: 'The Keeling Curve', question: 'How fast is CO₂ rising in the clean air above Hawaii?',
    bbox: { west: -156, south: 19, east: -155, north: 20 }, variable_id: 'mlo_co2',
    start: '1980-01-01', end: '2023-12-31', deseasonalize: true, center: { lat: 19.5, lon: -155.6 },
    related_variable_id: null, takeaway: 'Every single decade adds roughly 15–25 ppm of CO₂: no test is needed to see this one, but it passes all of them.',
  },
  {
    id: 'europe-sulfate', title: 'Did Europe clean its air?', question: 'Has sulfate haze over central Europe fallen since coal plants added scrubbers?',
    bbox: { west: 5, south: 45, east: 20, north: 54 }, variable_id: 'merra2_so4',
    start: '1985-01-01', end: '2023-12-31', deseasonalize: true, center: { lat: 50, lon: 12 },
    related_variable_id: null, takeaway: null,
  },
];

/** Region-specific trend factors that make the demo stories come out as the real data does. */
export const MOCK_STORY_TRENDS: { bbox: ExampleCase['bbox']; variable_id: string; factor: number }[] = [
  { bbox: MOCK_EXAMPLES[0].bbox, variable_id: 'gldas_groundwater', factor: 1.4 },
  { bbox: MOCK_EXAMPLES[0].bbox, variable_id: 'gpm_precipitation', factor: 0.4 },
  { bbox: MOCK_EXAMPLES[1].bbox, variable_id: 'omi_no2_trop', factor: 1.2 },
  { bbox: MOCK_EXAMPLES[4].bbox, variable_id: 'merra2_so4', factor: 2.5 },
];
