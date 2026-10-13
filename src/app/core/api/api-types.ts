import type { components } from './generated/api';

/** All DTO schemas of the backend, generated from `api/openapi.json`. */
export type Schemas = components['schemas'];

/** One DTO schema by name, for example `ApiSchema<'Track'>`. */
export type ApiSchema<Name extends keyof Schemas> = Schemas[Name];

export type Problem = Schemas['Problem'];
export type ProblemCode = Schemas['ProblemCode'];
export type FieldError = Schemas['FieldError'];
export type FieldErrorCode = Schemas['FieldErrorCode'];
export type EntityRef = Schemas['EntityRef'];
