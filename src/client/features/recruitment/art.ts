/**
 * The gashapon pictures the recruit page shows. Only the files imported here are published
 * with the website; everything else in Assets/ stays private.
 */
import goldCageUrl from "../../../../Assets/gacha/cage_gold.png";
import ironCageUrl from "../../../../Assets/gacha/cage_iron.png";
import bronzeCageUrl from "../../../../Assets/gacha/cage_copper.png";
import blueUrl from "../../../../Assets/gacha/capsule_blue.png";
import greenUrl from "../../../../Assets/gacha/capsule_green.png";
import orangeUrl from "../../../../Assets/gacha/capsule_orange.png";
import pinkUrl from "../../../../Assets/gacha/capsule_pink.png";
import redUrl from "../../../../Assets/gacha/capsule_red.png";
import yellowUrl from "../../../../Assets/gacha/capsule_yellow.png";
import machineUrl from "../../../../Assets/gacha/gashapon_machine_front.png";
import type { CageId } from "./api";
import type { CapsuleColor } from "./capsules";

export { professorArt } from "../world/art";

export const MACHINE_ART = machineUrl;

export const CAPSULE_ART: Record<CapsuleColor, string> = {
  yellow: yellowUrl,
  pink: pinkUrl,
  blue: blueUrl,
  green: greenUrl,
  orange: orangeUrl,
  red: redUrl,
};

export const CAGE_ART: Record<CageId, string> = {
  "golden-cage": goldCageUrl,
  "iron-cage": ironCageUrl,
  "bronze-cage": bronzeCageUrl,
};
