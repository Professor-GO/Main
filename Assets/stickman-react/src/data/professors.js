import chao_liu_front from "../assets/heads/chao_liu_front.webp";
import chao_liu_back from "../assets/heads/chao_liu_back.webp";
import craig_scratchley_front from "../assets/heads/craig_scratchley_front.webp";
import craig_scratchley_back from "../assets/heads/craig_scratchley_back.webp";
import frank_wood_front from "../assets/heads/frank_wood_front.webp";
import frank_wood_back from "../assets/heads/frank_wood_back.webp";
import guy_lumieux_front from "../assets/heads/guy_lumieux_front.webp";
import guy_lumieux_back from "../assets/heads/guy_lumieux_back.webp";
import michael_seica_front from "../assets/heads/michael_seica_front.webp";
import michael_seica_back from "../assets/heads/michael_seica_back.webp";
import shervin_jannesar_front from "../assets/heads/shervin_jannesar_front.webp";
import shervin_jannesar_back from "../assets/heads/shervin_jannesar_back.webp";
import tor_aamodt_front from "../assets/heads/tor_aamodt_front.webp";
import tor_aamodt_back from "../assets/heads/tor_aamodt_back.webp";

export const PROFESSORS = [
  {
    id: "chao_liu", name: "Chao Liu",
    front: { src: chao_liu_front, w: 192, h: 256 },
    back:  { src: chao_liu_back,  w: 212, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#e2e8f0", d:"#64748b", s:"#38bdf8", t:16, l:14, f:26, h:0 },
  },
  {
    id: "craig_scratchley", name: "Craig Scratchley",
    front: { src: craig_scratchley_front, w: 195, h: 256 },
    back:  { src: craig_scratchley_back,  w: 190, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#fde047", d:"#8a7a22", s:"#f97316", t:14, l:12, f:30, h:6 },
  },
  {
    id: "frank_wood", name: "Frank Wood",
    front: { src: frank_wood_front, w: 159, h: 256 },
    back:  { src: frank_wood_back,  w: 171, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#c084fc", d:"#6b4a8c", s:"#f0abfc", t:18, l:16, f:24, h:0 },
  },
  {
    id: "guy_lumieux", name: "Guy Lumieux",
    front: { src: guy_lumieux_front, w: 183, h: 256 },
    back:  { src: guy_lumieux_back,  w: 193, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#4ade80", d:"#2f7d4f", s:"#f8fafc", t:15, l:13, f:28, h:5 },
  },
  {
    id: "michael_seica", name: "Michael Seica",
    front: { src: michael_seica_front, w: 179, h: 256 },
    back:  { src: michael_seica_back,  w: 190, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#60a5fa", d:"#3b5f94", s:"#fbbf24", t:16, l:15, f:22, h:0 },
  },
  {
    id: "shervin_jannesar", name: "Shervin Jannesar",
    front: { src: shervin_jannesar_front, w: 188, h: 256 },
    back:  { src: shervin_jannesar_back,  w: 202, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#f9a8d4", d:"#9d5a7e", s:"#e2e8f0", t:17, l:14, f:32, h:6 },
  },
  {
    id: "tor_aamodt", name: "Tor Aamodt",
    front: { src: tor_aamodt_front, w: 210, h: 256 },
    back:  { src: tor_aamodt_back,  w: 228, h: 256 },
    // c/d: near/far colour, s: shoes, t: torso, l: limbs, f: foot length, h: hand dot
    body: { c:"#fb923c", d:"#9a5a2a", s:"#fef3c7", t:13, l:12, f:26, h:5 },
  },
];
