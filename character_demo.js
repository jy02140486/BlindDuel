import { Scene } from "./scripts/Scene.js";

async function start() {
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new Scene(engine, canvas);

    await scene.init();

    // 暴露到全局，方便控制台调试
    window.gameScene = scene;

    // 暂停键监听（P 或 Esc）
    window.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "p" || e.key === "Escape") {
            scene.togglePause();
        }
        if (e.key.toLowerCase() === "o") {
            scene.toggleCameraProjection();
        }
    });

    engine.runRenderLoop(() => {
        const dtMs = engine.getDeltaTime();
        scene.update(dtMs);
        scene.render();
    });

    window.addEventListener("resize", () => {
        scene.onResize();
        engine.resize();
    });
    window.addEventListener("beforeunload", () => {
        scene.dispose();
    }, { once: true });
}

start().catch((err) => {
    console.error(err);
    const msg = document.createElement("pre");
    msg.style.color = "#ff8a8a";
    msg.textContent = String(err);
    document.body.appendChild(msg);
});
