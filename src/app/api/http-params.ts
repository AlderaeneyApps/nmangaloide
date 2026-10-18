import { HttpParams } from '@angular/common/http';

type ParamValue = string | number | boolean | null | undefined;

/** Builds HttpParams, skipping null/undefined/empty-string values. */
export function toParams(values: Record<string, ParamValue>): HttpParams {
  let params = new HttpParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(name, String(value));
    }
  }
  return params;
}
