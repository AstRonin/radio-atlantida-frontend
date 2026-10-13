import { I18nService } from '../i18n/i18n.service';
import { ApiProblem } from './api-problem';

/**
 * The text to show for a failed request: the translation of its stable `code` in the active
 * language, else the backend's English `detail` as returned (docs/frontend-init-plan.md 1.3).
 */
export function problemMessage(problem: ApiProblem, i18n: I18nService): string {
  const key = `problems.${problem.code}`;
  return i18n.has(key) ? i18n.translate(key) : (problem.detail ?? problem.title);
}
