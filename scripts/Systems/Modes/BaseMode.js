export class BaseMode {
    constructor(id, context) {
        this.id = id;
        this.context = context;
    }

    enter(_payload) {}

    exit() {}

    fixedUpdate(_dtMs, _tickCount) {}

    updateRender(_dtMs) {}
}
