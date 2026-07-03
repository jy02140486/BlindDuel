import { Game } from "./scripts/Game.js";
import { SCENARIO } from "./Data/ScenarioMilestones.js";

async function start() {
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true, { stencil: true });
    const game = new Game(engine, canvas);

    await game.bootstrap();

    // 暴露到全局，方便控制台调试
    window.game = game;
    window.resetWorldState = () => game.resetWorldState();
    window.SCENARIO = SCENARIO;

    // 暂停键监听（P 或 Esc）
    window.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "p" || e.key === "Escape") {
            game.togglePause();
        }
        if (e.key.toLowerCase() === "c") {
            game.toggleCameraProjection();
        }
    });

    const FIXED_DT = 1000 / 60;
    let accumulator = 0;
    let tickCount = 0;

    engine.runRenderLoop(() => {
        const dtMs = engine.getDeltaTime();
        accumulator += dtMs;
        if (accumulator > 100) accumulator = 100;

        while (accumulator >= FIXED_DT) {
            tickCount++;
            game.fixedUpdate(FIXED_DT, tickCount);
            accumulator -= FIXED_DT;
        }

        game.updateRender(dtMs);
        game.render();
    });

    await game.init();

    window.addEventListener("resize", () => {
        game.onResize();
        engine.resize();
    });
    window.addEventListener("beforeunload", () => {
        game.dispose();
    }, { once: true });
}

start().catch((err) => {
    console.error(err);
    const msg = document.createElement("pre");
    msg.style.color = "#ff8a8a";
    msg.textContent = String(err);
    document.body.appendChild(msg);
});