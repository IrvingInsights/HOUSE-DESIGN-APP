import { loadLocalEnv } from './env.mjs';
import path from 'node:path';

loadLocalEnv();

export const PORT = Number(process.env.PORT || 5184);
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_PLANNER_MODEL = process.env.OPENAI_PLANNER_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_STUDIO_MODEL = process.env.OPENAI_STUDIO_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
export const OPENAI_IMAGE_MAX = Number(process.env.OPENAI_IMAGE_MAX || 3);
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
export const FREECAD_CMD = process.env.FREECAD_CMD || 'C:\\Program Files\\FreeCAD 1.1\\bin\\freecadcmd.exe';
export const DATA_DIR = path.resolve(process.cwd(), '.data');
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
export const DEFAULT_PROJECT_ID = 'current-project';
