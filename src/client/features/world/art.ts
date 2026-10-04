/**
 * The pictures the campus map draws. Only the files imported here are published with the
 * website; everything else in Assets/ stays private.
 */
import bushUrl from "../../../../Assets/outdoor/bush_round.png";
import flowersUrl from "../../../../Assets/outdoor/flowers_mixed.png";
import mailboxUrl from "../../../../Assets/outdoor/mailbox_red.png";
import oakUrl from "../../../../Assets/outdoor/tree_oak.png";
import pineUrl from "../../../../Assets/outdoor/tree_pine.png";
import rockUrl from "../../../../Assets/outdoor/rock_gray.png";
import arenaUrl from "../../../../Assets/fighting_scene/battle_clearing.png";
import bedUrl from "../../../../Assets/furniture/bed_oak_front.png";
import blackboardUrl from "../../../../Assets/classroom/blackboard_v1.png";
import bookshelfUrl from "../../../../Assets/furniture/bookshelf_front.png";
import brickUrl from "../../../../Assets/textures/wall_brick_gray.png";
import cageBronzeUrl from "../../../../Assets/gacha/cage_copper.png";
import cageGoldUrl from "../../../../Assets/gacha/cage_gold.png";
import cageIronUrl from "../../../../Assets/gacha/cage_iron.png";
import deskUrl from "../../../../Assets/furniture/desk_office_front.png";
import fridgeUrl from "../../../../Assets/furniture/refrigerator_front.png";
import machineUrl from "../../../../Assets/gacha/gashapon_machine_front.png";
import nightstandUrl from "../../../../Assets/furniture/nightstand_lamp_front.png";
import plantUrl from "../../../../Assets/classroom/plant_potted_v1.png";
import sofaUrl from "../../../../Assets/furniture/sofa_green_front.png";
import studentDeskUrl from "../../../../Assets/furniture/desk_student_front.png";
import tileUrl from "../../../../Assets/textures/floor_tile_beige.png";
import tvUrl from "../../../../Assets/furniture/tv_stand_front.png";
import windowUrl from "../../../../Assets/classroom/window_front_v1.png";
import woodUrl from "../../../../Assets/textures/floor_wood_plank.png";
import type { RoomArt } from "./Game Mechanics/rooms";
import type { PropKind } from "./Game Mechanics/world";

/** The picture for each piece of furniture in the rooms. */
export const ROOM_ART: Record<RoomArt, string> = {
  bed: bedUrl,
  nightstand: nightstandUrl,
  bookshelf: bookshelfUrl,
  sofa: sofaUrl,
  tv: tvUrl,
  desk: deskUrl,
  fridge: fridgeUrl,
  plant: plantUrl,
  window: windowUrl,
  blackboard: blackboardUrl,
  studentDesk: studentDeskUrl,
  machine: machineUrl,
};
/** The repeating textures for floors and walls. */
export const TEXTURES = { wood: woodUrl, tile: tileUrl, brick: brickUrl };
/** The window on the outside of the school. */
export const WINDOW_ART = windowUrl;
/** The grassy clearing that battles take place in. */
export const ARENA_ART = arenaUrl;
/** The gashapon machine, seen from the front. */
export const MACHINE_ART = machineUrl;
/** The picture of each cage, by the cage's id. */
export const CAGE_ART: Record<string, string> = {
  "golden-cage": cageGoldUrl,
  "iron-cage": cageIronUrl,
  "bronze-cage": cageBronzeUrl,
};
/** The capsules that tumble around inside the gashapon machine. */
export const CAPSULE_ART: readonly string[] = Object.values(
  import.meta.glob<string>("../../../../Assets/gacha/capsule_*.png", {
    eager: true,
    query: "?url",
    import: "default",
  }),
);

/** The picture for each kind of scenery that has one. The buildings are drawn in code. */
export const PROP_ART: Partial<Record<PropKind, string>> = {
  oak: oakUrl,
  pine: pineUrl,
  bush: bushUrl,
  rock: rockUrl,
  flowers: flowersUrl,
  mailbox: mailboxUrl,
};

// Every professor's front-view picture, keyed by its path. Vite only adds a picture's URL to
// the page; the browser downloads it the first time it is drawn.
const PROFESSOR_ART = import.meta.glob<string>(
  "../../../../Assets/characters/*/*_front.png",
  { eager: true, query: "?url", import: "default" },
);

/**
 * Finds a professor's front-view picture. The folders in Assets/characters are named after
 * the professor ids, with underscores instead of hyphens ("chao-liu" is in "chao_liu").
 * @param professorId - The professor's id, such as "chao-liu".
 * @returns The picture's URL, or undefined if there is no picture for them.
 */
export function professorArt(professorId: string): string | undefined {
  const folder = professorId.replaceAll("-", "_");
  return PROFESSOR_ART[
    `../../../../Assets/characters/${folder}/${folder}_front.png`
  ];
}
