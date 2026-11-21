/** Every static asset path goes through here so the Vite base path (GitHub Pages subfolder) is applied once. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

/** Official artwork from the PokéAPI sprites repository, loaded at runtime (never bundled). */
export const pokemonArt = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

/** 3D model (Draco-compressed GLB, WebP textures) from the community Pokémon 3D API, loaded at runtime. */
export const pokemonModel = (dex: number, folder = 'regular') =>
  `https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt/${folder}/${dex}.glb`;

/** Cry (OGG) from the PokéAPI cries repository, loaded at runtime. */
export const pokemonCry = (dex: number) =>
  `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${dex}.ogg`;
