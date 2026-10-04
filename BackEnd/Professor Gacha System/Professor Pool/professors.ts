// The professors that can be recruited through the gacha.
//
// Edit this list to change the roster. Pull chances and rarities are calculated
// from avgRating in ../gacha.ts, so they never need to be entered by hand:
// the higher a professor's rating, the harder they are to pull.
//
// This list is shared by every player. Anything that differs from player to
// player, such as a professor's level, is stored in the inventory table instead
// (see BackEnd/schema.sql).
//
// The entries below are fictional placeholders until the real roster is chosen.

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
    image: string; // Website path to the professor's picture. The image files have not been added yet
    avgRating: number; // Average student rating from 1 to 5.
    department: Department; // The department the professor belongs to. This is used for battle mechanics like element in pokemon.
    stats: ProfessorStats; // The stats of the professor, like health defence speed.
    copiesToLevelUp: number; // How many duplicate copies a player spends to level this professor up once. The professor itself is never used up.
};

export const PROFESSOR_POOL: readonly ProfessorEntry[] = [
    {
        id: "dr-quark",
        name: "Dr. Quark",
        image: "/professors/dr-quark.png",
        avgRating: 4.8,
        department: "Physics",
        stats: { health: 95, attack: 90, defense: 80, speed: 75 },
        copiesToLevelUp: 2,
    },
    {
        id: "prof-byte",
        name: "Prof. Byte",
        image: "/professors/prof-byte.png",
        avgRating: 4.6,
        department: "Computer Science",
        stats: { health: 90, attack: 95, defense: 60, speed: 85 },
        copiesToLevelUp: 2,
    },
    {
        id: "dr-vector",
        name: "Dr. Vector",
        image: "/professors/dr-vector.png",
        avgRating: 4.2,
        department: "Mathematics",
        stats: { health: 85, attack: 80, defense: 75, speed: 70 },
        copiesToLevelUp: 3,
    },
    {
        id: "prof-chronicle",
        name: "Prof. Chronicle",
        image: "/professors/prof-chronicle.png",
        avgRating: 3.9,
        department: "History",
        stats: { health: 70, attack: 60, defense: 75, speed: 55 },
        copiesToLevelUp: 4,
    },
    {
        id: "prof-helix",
        name: "Prof. Helix",
        image: "/professors/prof-helix.png",
        avgRating: 3.7,
        department: "Biology",
        stats: { health: 80, attack: 65, defense: 70, speed: 60 },
        copiesToLevelUp: 4,
    },
    {
        id: "dr-catalyst",
        name: "Dr. Catalyst",
        image: "/professors/dr-catalyst.png",
        avgRating: 3.3,
        department: "Chemistry",
        stats: { health: 70, attack: 75, defense: 55, speed: 65 },
        copiesToLevelUp: 4,
    },
    {
        id: "prof-sonnet",
        name: "Prof. Sonnet",
        image: "/professors/prof-sonnet.png",
        avgRating: 2.9,
        department: "English",
        stats: { health: 65, attack: 55, defense: 60, speed: 70 },
        copiesToLevelUp: 5,
    },
    {
        id: "dr-ledger",
        name: "Dr. Ledger",
        image: "/professors/dr-ledger.png",
        avgRating: 2.4,
        department: "Economics",
        stats: { health: 75, attack: 50, defense: 65, speed: 45 },
        copiesToLevelUp: 5,
    },
];
