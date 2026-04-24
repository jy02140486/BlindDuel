import { Scene } from "./scripts/Scene.js";

async function start() {
    const canvas = document.getElementById("renderCanvas");
    const engine = new BABYLON.Engine(canvas, true);
    const scene = new Scene(engine, canvas);

    await scene.init();

    engine.runRenderLoop(() => {
        const dtMs = engine.getDeltaTime();
        scene.update(dtMs);
        scene.render();
    });

    window.addEventListener("resize", () => engine.resize());
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
