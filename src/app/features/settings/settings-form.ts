import { AbstractControl, FormControl, ValidatorFn, Validators } from '@angular/forms';
import type { ApiSchema } from '../../core/api/api-types';
import type { Setting } from '../../core/settings/settings.service';
import { rangeValidator } from '../../shared/forms/validators';

export type SettingGroup = Setting['group'];
export type SecretStatus = ApiSchema<'SecretStatus'>;

/** Sections of the page, in the order of the plan (docs/frontend-init-plan.md F5 task 1). */
export const GROUP_ORDER: readonly SettingGroup[] = [
  'station',
  'stream',
  'liquidsoap',
  'rotation',
  'outage',
  'retention',
  'playout',
  'air',
  'import',
];

/**
 * How a setting is edited. Most follow from the metadata the backend sends (type, enum, limits);
 * two keys need a dedicated input: a timezone from the IANA list and a playlist.
 */
export type SettingKind = 'number' | 'select' | 'text' | 'boolean' | 'timezone' | 'playlist';

const SPECIAL_KINDS: Readonly<Record<string, SettingKind>> = {
  'station.timezone': 'timezone',
  'playout.emergency_playlist_id': 'playlist',
};

export function settingKind(setting: Setting): SettingKind {
  const special = SPECIAL_KINDS[setting.key];
  if (special) {
    return special;
  }
  if (setting.enum && setting.enum.length > 0) {
    return 'select';
  }
  switch (setting.type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'text';
  }
}

/** The control of one setting, with validators that mirror the backend's definition. */
export function settingControl(setting: Setting): AbstractControl {
  const kind = settingKind(setting);
  const required = setting.nullable ? [] : [Validators.required];
  switch (kind) {
    case 'number':
      return new FormControl<number | null>(numberOrNull(setting.value), [
        ...required,
        rangeValidator({
          min: setting.minimum ?? Number.MIN_SAFE_INTEGER,
          max: setting.maximum ?? Number.MAX_SAFE_INTEGER,
          step: setting.type === 'integer' ? 1 : undefined,
        }),
      ]);
    case 'boolean':
      return new FormControl<boolean>(setting.value === true, { nonNullable: true });
    case 'playlist':
      return new FormControl<number | null>(numberOrNull(setting.value), required);
    case 'select':
      return new FormControl<unknown>(setting.value, required);
    default: {
      // An empty text is a value, not a missing one: stream.description may be "". Only a
      // minimum length makes the field required.
      const validators: ValidatorFn[] = [];
      if (setting.minimum !== undefined && setting.minimum > 0) {
        validators.push(Validators.required, Validators.minLength(setting.minimum));
      }
      if (setting.maximum !== undefined) {
        validators.push(Validators.maxLength(setting.maximum));
      }
      return new FormControl<string | null>(
        typeof setting.value === 'string' ? setting.value : '',
        validators,
      );
    }
  }
}

/** The value to send for a control, in the JSON form of the setting. */
export function controlValue(setting: Setting, control: AbstractControl): unknown {
  const value: unknown = control.value;
  if (settingKind(setting) === 'text') {
    return value ?? '';
  }
  return value === undefined ? null : value;
}

/** True when the control holds a value other than the saved one. */
export function isChanged(setting: Setting, control: AbstractControl): boolean {
  return canonical(controlValue(setting, control)) !== canonical(setting.value);
}

/** The value a control is reset to after a save or a discard. */
export function resetValue(setting: Setting): unknown {
  return setting.value;
}

// Key order and absent versus null fields do not make two objects different.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item)
            .filter(([, field]) => field !== null && field !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
