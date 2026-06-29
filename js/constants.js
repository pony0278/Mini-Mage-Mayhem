// Fixed arena dimensions. The canvas is 960x640 in all three HTML shells, so
// these are hardcoded (previously read from canvas.width/height).
export const W = 960;
export const H = 640;
export const TILE = 32;
export const COLS = W / TILE; // 30
export const ROWS = H / TILE; // 20

// Tile-map enum (game.map cells).
export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_THIN = 2;
export const TILE_GRASS = 3;
export const TILE_BURNT = 4;
export const TILE_WATER = 5;
export const TILE_ICE = 6;
export const TILE_ICEWALL = 7; // player-built ice wall (solid, melts to floor via fire/steam)
export const TILE_OIL = 8;     // spilled oil (walkable; ignites into a big explosion on fire)
export const TILE_VOID = 9;    // a pit / hole — entities over it fall (環境處決 v2: dumb-death A)
