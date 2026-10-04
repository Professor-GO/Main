// The professors that can be recruited through the gacha.
//
// Edit this list to change the roster. Pull chances and rarities are calculated
// from avgRating in ../application/recruitment.ts, so they never need to be entered by hand:
// the higher a professor's rating, the harder they are to pull. Health and attack
// are calculated from avgRating below, in inverse: the higher the rating, the lower they are.
//
// This list is shared by every player. Anything that differs from player to
// player, such as a professor's level, is stored in the inventory table instead
// (see src/server/storage/schema.sql).
//
// The names and images match the folders in Assets/characters. The ratings,
// departments, defense, speed, and copiesToLevelUp are still placeholders until the real values are chosen.

// Departments act as the professors' elements in battle.
export const DEPARTMENTS = [
    "Computer Science",
    "Mathematics",
    "Engineering Science",
    "Computer Engineering",
    "Biology",
    "Mechanical Engineering",
    "Economics",
    "History",
] as const;

export type Department = typeof DEPARTMENTS[number];

export type ProfessorStats = {
    health: number;
    attack: number;
    defense: number;
    speed: number;
};

export type ProfessorEntry = {
    id: string; // Unique identifier for the professor. This is used to reference the professor in code and should not be changed once players have recruited them.
    name: string; // Full name of the professor. This is displayed to players and can be changed if needed.
    image: string; // Path to the professor's front-view picture in Assets/characters. The server does not serve these files yet.
    avgRating: number; // Average student rating from 1 to 5.
    department: Department; // The department the professor belongs to. This is used for battle mechanics like element in pokemon.
    stats: ProfessorStats; // The stats of the professor, like health defence speed.
    copiesToLevelUp: number; // How many duplicate copies a player spends to level this professor up once. The professor itself is never used up.
};

// Health and attack are worked out from avgRating, so the roster only lists the other stats.
type RosterEntry = Omit<ProfessorEntry, "stats"> & { stats: Omit<ProfessorStats, "health" | "attack"> };

// Health and attack are these values divided by avgRating: the lower a professor's
// rating, the more health and attack they have.
export const HEALTH_SCALE = 240;
export const ATTACK_SCALE = 220;

const ROSTER: readonly RosterEntry[] = [
    {
        id: "frank-wood",
        name: "Frank Wood",
        image: "/Assets/characters/frank_wood/frank_wood_front.png",
        avgRating: 4.8,
        department: "Computer Science",
        stats: { defense: 80, speed: 75 },
        copiesToLevelUp: 2,
    },
    {
        id: "shervin-jannesar",
        name: "Shervin Jannesar",
        image: "/Assets/characters/shervin_jannesar/shervin_jannesar_front.png",
        avgRating: 3.6,
        department: "Computer Science",
        stats: { defense: 60, speed: 85 },
        copiesToLevelUp: 4,
    },
    {
        id: "tor-aamodt",
        name: "Tor Aamodt",
        image: "/Assets/characters/tor_aamodt/tor_aamodt_front.png",
        avgRating: 4.2,
        department: "Computer Engineering",
        stats: { defense: 75, speed: 70 },
        copiesToLevelUp: 3,
    },
    {
        id: "craig-scratchley",
        name: "Craig Scratchley",
        image: "/Assets/characters/craig_scratchley/craig_scratchley_front.png",
        avgRating: 3.9,
        department: "Computer Engineering",
        stats: { defense: 75, speed: 55 },
        copiesToLevelUp: 4,
    },
    {
        id: "michael-seica",
        name: "Michael Seica",
        image: "/Assets/characters/michael_seica/michael_seica_front.png",
        avgRating: 2.7,
        department: "Mathematics",
        stats: { defense: 70, speed: 60 },
        copiesToLevelUp: 5,
    },
    {
        id: "chao-liu",
        name: "Chao Liu",
        image: "/Assets/characters/chao_liu/chao_liu_front.png",
        avgRating: 5.0,
        department: "Mechanical Engineering",
        stats: { defense: 55, speed: 65 },
        copiesToLevelUp: 2,
    },
    {
        id: "guy-lumieux",
        name: "Guy Lumieux",
        image: "/Assets/characters/guy_lumieux/guy_lumieux_front.png",
        avgRating: 1.2,
        department: "Computer Engineering",
        stats: { defense: 60, speed: 70 },
        copiesToLevelUp: 5,
    },
];

export const PROFESSOR_POOL: readonly ProfessorEntry[] = ROSTER.map((professor) => ({
    ...professor,
    stats: {
        health: Math.round(HEALTH_SCALE / professor.avgRating),
        attack: Math.round(ATTACK_SCALE / professor.avgRating),
        ...professor.stats,
    },
}));
