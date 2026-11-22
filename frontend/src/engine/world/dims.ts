/**
 * Stage dimensions in world units. Partners and battling Pokémon keep their own sizes (character/size.ts);
 * the stadium around them was enlarged so the plaza is a place to wander and the battle field has room.
 */

/** The stadium (platform, barrier wall, stands, floodlight towers) against its first build. */
export const STADIUM = 1.6;
/** The battle field (Pokémon spots, trainer boxes, field lines, battle camera) against its first build. */
export const FIELD = 1.25;
/** Radius of the stage platform. Partners walk the plaza on it (PLAZA_R in the shared protocol is a little less). */
export const PLATFORM_R = 6 * STADIUM;
/** Radius of the barrier wall where the stands begin. */
export const WALL_R = 8.4 * STADIUM;
