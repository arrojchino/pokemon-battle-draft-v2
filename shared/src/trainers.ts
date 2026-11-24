/**
 * Trainer models a player can pick for their plaza trainer. Shared by the client (loading, picker) and the
 * server (allowlist for the hub member state). Every model is a VRM humanoid under `frontend/public/`, with its
 * source and license recorded in `docs/ASSETS.md` (Trainers section).
 *
 * `file` is relative to the site base. `height` is the world height (units, 1.7 m each) the trainer is scaled
 * to; it defaults to 0.98.
 */
export interface TrainerModel {
  id: string;
  file: string;
  height?: number;
  credit: string;
  license: string;
}

export const TRAINER_MODELS = [
  { id: 'classic', file: 'npc/presenter.vrm', height: 0.98, credit: 'pixiv Inc. / VRoid Project: beta AvatarSample_4 (recoloured)', license: 'CC0-1.0' },
  { id: 'shibu', file: 'trainers/shibu.vrm', height: 0.93, credit: 'pixiv Inc. / VRoid Project: beta AvatarSample_1', license: 'CC0-1.0' },
  { id: 'vivi', file: 'trainers/vivi.vrm', height: 0.96, credit: 'pixiv Inc. / VRoid Project: beta AvatarSample_2', license: 'CC0-1.0' },
  { id: 'vita', file: 'trainers/vita.vrm', height: 0.96, credit: 'pixiv Inc. / VRoid Project: beta AvatarSample_3', license: 'CC0-1.0' },
  { id: 'hana', file: 'trainers/hana.vrm', height: 0.96, credit: 'pixiv Inc. / VRoid Project: HairSample_Female', license: 'CC0-1.0' },
  { id: 'kai', file: 'trainers/kai.vrm', height: 1.03, credit: 'pixiv Inc. / VRoid Project: HairSample_Male', license: 'CC0-1.0' },
  { id: 'kate', file: 'trainers/kate.vrm', height: 0.98, credit: 'Polygonal Mind: 100Avatars 038 Kate', license: 'CC0-1.0' },
  { id: 'kyle', file: 'trainers/kyle.vrm', height: 1.02, credit: 'Polygonal Mind: 100Avatars 069 Kyle', license: 'CC0-1.0' },
] as const satisfies readonly TrainerModel[];

export type TrainerId = (typeof TRAINER_MODELS)[number]['id'];

export const TRAINER_IDS: readonly TrainerId[] = TRAINER_MODELS.map(m => m.id);

/** The model a trainer falls back to (an unknown or missing id, an old client). */
export const DEFAULT_TRAINER: TrainerId = 'classic';

export const isTrainerId = (v: unknown): v is TrainerId => typeof v === 'string' && (TRAINER_IDS as readonly string[]).includes(v);

export function trainerModel(id: unknown): TrainerModel {
  return TRAINER_MODELS.find(m => m.id === id) ?? TRAINER_MODELS[0];
}
