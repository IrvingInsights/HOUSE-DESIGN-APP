import { buildContextPacket, ensureProjectBrain } from './project-brain-service.mjs';
import { studioRespond } from './studio.mjs';

export async function respondFromStudioAgent(payload) {
  const spec = payload.spec || payload.bim || {};
  const projectBrain = ensureProjectBrain(payload.projectBrain, spec);
  const contextPacket = payload.contextPacket || buildContextPacket(spec, projectBrain, payload.selected, payload.prompt);
  return studioRespond({
    ...payload,
    projectBrain,
    contextPacket
  });
}
