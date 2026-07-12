import { loadLocalEnv } from './env.mjs';
import path from 'node:path';

loadLocalEnv();

export const PORT = Number(process.env.PORT || 5184);
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_PLANNER_MODEL = process.env.OPENAI_PLANNER_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_STUDIO_MODEL = process.env.OPENAI_STUDIO_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_IMAGE_MAX = Number(process.env.OPENAI_IMAGE_MAX || 3);
// The rolling alias survives model retirements (gemini-2.5-flash was retired
// out from under us and every plan silently fell back to the local parser).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
// The stronger tier for auto-retry escalation when a trace scores below the
// gate. SAME rolling-alias rule — never pin a dated model here.
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || 'gemini-pro-latest';
export const DATA_DIR = path.resolve(process.cwd(), '.data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const DEFAULT_PROJECT_ID = 'current-project';
