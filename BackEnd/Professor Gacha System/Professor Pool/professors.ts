// The professors that can be recruited through the gacha.
//
// Edit this list to change the roster. Pull chances and rarities are calculated
// from avgRating in ../gacha.ts, so they never need to be entered by hand:
// the higher a professor's rating, the harder they are to pull.
//
// The names and images match the folders in Assets/characters. The ratings,
// departments, and stats are still placeholders until the real values are chosen.

// Departments act as the professors' elements in battle.
export const DEPARTMENTS = [
    "Computer Science",
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "English",
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
};

export const PROFESSOR_POOL: readonly ProfessorEntry[] = [
    {
        id: "frank-wood",
        name: "Frank Wood",
        image: "/Assets/characters/frank_wood/frank_wood_front.png",
        avgRating: 4.8,
        department: "Physics",
        stats: { health: 95, attack: 90, defense: 80, speed: 75 },
    },
    {
        id: "shervin-jannesar",
        name: "Shervin Jannesar",
        image: "/Assets/characters/shervin_jannesar/shervin_jannesar_front.png",
        avgRating: 4.6,
        department: "Computer Science",
        stats: { health: 90, attack: 95, defense: 60, speed: 85 },
    },
    {
        id: "tor-aamodt",
        name: "Tor Aamodt",
        image: "/Assets/characters/tor_aamodt/tor_aamodt_front.png",
        avgRating: 4.2,
        department: "Mathematics",
        stats: { health: 85, attack: 80, defense: 75, speed: 70 },
    },
    {
        id: "craig-scratchley",
        name: "Craig Scratchley",
        image: "/Assets/characters/craig_scratchley/craig_scratchley_front.png",
        avgRating: 3.9,
        department: "History",
        stats: { health: 70, attack: 60, defense: 75, speed: 55 },
    },
    {
        id: "michael-seica",
        name: "Michael Seica",
        image: "/Assets/characters/michael_seica/michael_seica_front.png",
        avgRating: 3.7,
        department: "Biology",
        stats: { health: 80, attack: 65, defense: 70, speed: 60 },
    },
    {
        id: "chao-liu",
        name: "Chao Liu",
        image: "/Assets/characters/chao_liu/chao_liu_front.png",
        avgRating: 3.3,
        department: "Chemistry",
        stats: { health: 70, attack: 75, defense: 55, speed: 65 },
    },
    {
        id: "guy-lumieux",
        name: "Guy Lumieux",
        image: "/Assets/characters/guy_lumieux/guy_lumieux_front.png",
        avgRating: 2.9,
        department: "English",
        stats: { health: 65, attack: 55, defense: 60, speed: 70 },
    },
];
