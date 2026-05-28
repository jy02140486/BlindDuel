import { CharacterBase } from "./CharacterBase.js";
import { NpcFrameComponent } from "../Components/NpcFrameComponent.js";

export class NpcCharacter extends CharacterBase {
    constructor(scene, config) {
        const animation = new NpcFrameComponent(config.clips);

        config._animation = animation;
        config._collision = null;

        super(scene, config);

        this.rootMotion = config.rootMotion ?? null;
        this.occupancy = config.occupancy ?? null;
    }

    _getCurrentRootAnchor(frameIndex) {
        const occ = this.occupancy;
        if (occ && occ.frames) {
            if (frameIndex >= 0 && frameIndex < occ.frames.length) {
                const root = occ.frames[frameIndex]?.anchors?.root;
                if (root) {
                    return { cx: root.cx, cy: root.cy };
                }
            }
        }

        // fallback: rootMotion frame center
        const rootMotionData = this.rootMotion;
        if (!rootMotionData || !rootMotionData.frames) {
            return null;
        }

        const frameEntries = Object.values(rootMotionData.frames);
        if (frameIndex < 0 || frameIndex >= frameEntries.length) {
            return null;
        }

        const frame = frameEntries[frameIndex]?.frame;
        if (!frame) {
            return null;
        }

        return {
            cx: frame.w / 2,
            cy: frame.h
        };
    }

    getBlockerAabb() {
        const occ = this.occupancy;
        if (!occ || !occ.frames) return null;

        const frameIndex = this.animation?.currentFrameIndex ?? 0;
        if (frameIndex < 0 || frameIndex >= occ.frames.length) return null;

        const occFrame = occ.frames[frameIndex]?.occupancy;
        if (!occFrame) return null;

        const halfW = (occFrame.w / 2) * this.pxToWorld;
        const halfH = (occFrame.h / 2) * this.pxToWorld;

        return {
            minX: this.root.position.x - halfW,
            maxX: this.root.position.x + halfW,
            minY: this.root.position.y - halfH,
            maxY: this.root.position.y + halfH
        };
    }
}