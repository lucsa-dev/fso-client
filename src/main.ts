import Phaser from "phaser";
import { BootScene } from "@/scenes/BootScene";
import { LoginScene } from "@/scenes/LoginScene";
import { RegisterScene } from "@/scenes/RegisterScene";
import { SettingsScene } from "@/scenes/SettingsScene";
import { GameScene } from "@/scenes/GameScene";
import cursorUrl from "@/assets/interface/cursor-32.png";

document.body.style.cursor = `url("${cursorUrl}") 2 2, auto`;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#0a0a0a",
  // Tile art, sampled with the default bilinear filter, bleeds its
  // neighbor's edge pixels through whenever the camera sits at a
  // fractional-pixel scroll position — the thin flickering seams between
  // tiles when following the player. `pixelArt: true` switches every
  // texture to nearest-neighbor filtering and rounds the camera's render
  // position to whole pixels, so tiles never sample past their own edge.
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: "100%",
    height: "100%",
  },
  dom: {
    createContainer: true,
  },
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
  scene: [BootScene, LoginScene, RegisterScene, SettingsScene, GameScene],
};

new Phaser.Game(config);
