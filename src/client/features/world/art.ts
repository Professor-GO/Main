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
import type { PropKind } from "./world";

/** The picture for each kind of scenery that has one. The house is drawn in code. */
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
