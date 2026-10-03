import { prefSwitch } from "../connection/pref-switch";

/** "Show images in conversations": load them as they appear. Off, tap one to load it. */
const images = prefSwitch("images", false);

export const useImagesShown = images.use;
export const setImagesShown = images.set;
