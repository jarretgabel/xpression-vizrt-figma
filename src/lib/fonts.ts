import type { FontSubstitution, FontSubstitutionMap } from '../types';

function normalizeSubstitution(value: unknown): FontSubstitution | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      family: value.trim(),
    };
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const family = typeof (value as { family?: unknown }).family === 'string'
    ? (value as { family: string }).family.trim()
    : '';
  const postScriptName = typeof (value as { postScriptName?: unknown }).postScriptName === 'string'
    ? (value as { postScriptName: string }).postScriptName.trim()
    : undefined;

  if (!family) {
    return null;
  }

  return {
    family,
    postScriptName,
  };
}

export function parseFontSubstitutionEnv(rawValue: string | undefined): FontSubstitutionMap {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return Object.entries(parsed).reduce<FontSubstitutionMap>((accumulator, [fromFamily, toValue]) => {
      const normalized = normalizeSubstitution(toValue);
      if (!normalized || !fromFamily.trim()) {
        return accumulator;
      }

      accumulator[fromFamily.trim()] = normalized;
      return accumulator;
    }, {});
  } catch {
    return {};
  }
}