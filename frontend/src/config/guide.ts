import type { ExampleCase, Sphere, Variable } from '../api/types';

/**
 * "Help me choose": the guided start on the globe screen. Themes are a thin layer over the catalog:
 * each lists variable ids in order of preference (the first available one is preselected). Any variable
 * the catalog adds later that no theme lists falls into a theme by `fallback` (series records first,
 * then sphere), or into a plain per-sphere theme, so new ids still show up without touching this file.
 */
export type GuideTheme = {
  id: string;
  label: string;
  /** One line in the "field notes" voice, shown when the option is focused or hovered. */
  hint: string;
  variableIds: string[];
  fallback?: { spheres?: Sphere[]; series?: boolean };
  /** Where "I'll pick a place on the map" flies to when the theme has no example case. */
  focus?: { lat: number; lon: number };
};

export const guideThemes: GuideTheme[] = [
  {
    id: 'water',
    label: 'Water underground & rain',
    hint: 'Is the ground drying out, and is the rain to blame?',
    variableIds: ['gldas_gws', 'gldas_tws', 'gpm_precipitation'],
    fallback: { spheres: ['water'] },
    focus: { lat: 30.5, lon: 75.5 },
  },
  {
    id: 'air',
    label: 'Air pollution',
    hint: 'Traffic fumes, coal smoke and dust: is the air getting cleaner or dirtier?',
    variableIds: ['omi_no2', 'merra2_so2', 'merra2_aod', 'merra2_bc', 'merra2_oc', 'merra2_so4', 'merra2_sulfate_aod', 'merra2_dust'],
    fallback: { spheres: ['atmosphere'] },
    focus: { lat: 28.6, lon: 77.2 },
  },
  {
    id: 'heat',
    label: 'Heat in cities',
    hint: 'Do cities stay hotter at night than they used to?',
    variableIds: ['modis_lst_night', 'modis_lst_day'],
    fallback: { spheres: ['land'] },
    focus: { lat: 33.45, lon: -112.07 },
  },
  {
    id: 'green',
    label: 'Forests & green land',
    hint: 'Is the land greening up, or are forests being cleared?',
    variableIds: ['modis_ndvi'],
    focus: { lat: -10.9, lon: -62.8 },
  },
  {
    id: 'ghg',
    label: 'Greenhouse gases',
    hint: 'The long records of carbon dioxide and methane in the air we all share.',
    variableIds: ['mauna_loa_co2', 'noaa_co2_marine', 'noaa_ch4_marine'],
    fallback: { series: true },
  },
];

const SPHERE_LABEL: Record<Sphere, string> = {
  atmosphere: 'The atmosphere',
  land: 'The land surface',
  ocean: 'The ocean',
  water: 'The water cycle',
};

export type ResolvedTheme = GuideTheme & { variables: Variable[]; examples: ExampleCase[] };

/** Group the live catalog into themes. Themes with no available variables are dropped. */
export function resolveGuideThemes(variables: Variable[], examples: ExampleCase[]): ResolvedTheme[] {
  const themes = guideThemes.map((t) => ({
    ...t,
    variables: t.variableIds.map((id) => variables.find((v) => v.id === id)).filter((v): v is Variable => !!v),
  }));
  const listed = new Set(guideThemes.flatMap((t) => t.variableIds));
  const extra: (GuideTheme & { variables: Variable[] })[] = [];

  for (const v of variables) {
    if (listed.has(v.id)) continue;
    const home =
      (v.coverage === 'series' && themes.find((t) => t.fallback?.series)) || themes.find((t) => t.fallback?.spheres?.includes(v.sphere));
    if (home) {
      home.variables.push(v);
      continue;
    }
    let own = extra.find((t) => t.id === `sphere:${v.sphere}`);
    if (!own) {
      own = { id: `sphere:${v.sphere}`, label: SPHERE_LABEL[v.sphere] ?? v.sphere, hint: v.why_it_matters, variableIds: [], variables: [] };
      extra.push(own);
    }
    own.variables.push(v);
  }

  return [...themes, ...extra]
    .filter((t) => t.variables.length > 0)
    .map((t) => {
      const ids = new Set(t.variables.map((v) => v.id));
      return { ...t, examples: examples.filter((ex) => ids.has(ex.variable_id)) };
    });
}
