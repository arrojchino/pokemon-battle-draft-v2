/** Every static asset path goes through here so the Vite base path (GitHub Pages subfolder) is applied once. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

export const pokemonArt = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
