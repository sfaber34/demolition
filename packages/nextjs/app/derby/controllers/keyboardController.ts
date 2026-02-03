import type { WorldSim } from "../sim/typesSim";
import type { CarController } from "./controllerTypes";

/**
 * Keyboard controller: allows player to control one car with arrow keys.
 * - Up/Down: throttle (forward/reverse)
 * - Left/Right: steering
 */
export class KeyboardController implements CarController {
  private keys: Set<string> = new Set();
  private carIndex: number;
  private cleanupFn: (() => void) | null = null;

  constructor(carIndex: number = 0) {
    this.carIndex = carIndex;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Only run in browser environment
    if (typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        this.keys.add(e.key);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.key);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    this.cleanupFn = () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }

  /** Call this when done to remove event listeners */
  cleanup(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }

  /** Get current input from keyboard state (for WASM integration) */
  getInput(): { throttle: number; steer: number } {
    let throttle = 0;
    if (this.keys.has("ArrowUp")) throttle += 1;
    if (this.keys.has("ArrowDown")) throttle -= 1;

    let steer = 0;
    if (this.keys.has("ArrowLeft")) steer -= 1;
    if (this.keys.has("ArrowRight")) steer += 1;

    return { throttle, steer };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(world: WorldSim, _dtMs: number, _nowMs: number): void {
    if (world.gamePhase !== "playing") return;

    const car = world.cars[this.carIndex];
    if (!car || !car.isAlive) return;

    car.input = this.getInput();
  }
}
