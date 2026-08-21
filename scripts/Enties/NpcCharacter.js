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
        this.isCompanion = config.isCompanion ?? false;
        this._isFollowing = false;

        // Force-debug panel above character head (companion only)
        if (this.isCompanion) {
            this._forcePanel = this._createForcePanel();
        }
    }

    _createForcePanel() {
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.pointerEvents = "none";
        panel.style.background = "rgba(20, 30, 50, 0.85)";
        panel.style.color = "#a8e6ff";
        panel.style.font = "11px/1.3 Consolas, monospace";
        panel.style.padding = "4px 6px";
        panel.style.borderRadius = "4px";
        panel.style.border = "1px solid rgba(120, 200, 255, 0.5)";
        panel.style.whiteSpace = "nowrap";
        panel.style.zIndex = "1001";
        panel.style.display = "none";
        document.body.appendChild(panel);
        return panel;
    }

    dispose() {
        if (this._forcePanel) {
            this._forcePanel.remove();
            this._forcePanel = null;
        }
        super.dispose();
    }

    setFollowing(value) {
        this._isFollowing = !!value;
    }

    isBlockingNow() {
        if (!this.blocksMovement) return false;
        if (this._isFollowing) return false;
        return true;
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

    _updateDebugPanel() {
        super._updateDebugPanel();

        if (!this._forcePanel) return;
        if (!this.rootDebugVisible) {
            this._forcePanel.style.display = "none";
            return;
        }

        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        // Project a point above the character's head
        const worldPos = this.root.position.clone();
        worldPos.y += 1.2;

        const projected = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
        );

        if (projected.z > 0 && projected.z < 1) {
            this._forcePanel.style.display = "block";
            this._forcePanel.style.left = `${projected.x - this._forcePanel.offsetWidth / 2}px`;
            this._forcePanel.style.top = `${projected.y}px`;
        } else {
            this._forcePanel.style.display = "none";
        }

        // Read force debug data from following behavior
        const behavior = this.npcController?._followingBehavior;
        const d = behavior?._debugData;
        if (!d) {
            this._forcePanel.textContent = "(no force data)";
            return;
        }

        this._forcePanel.textContent =
`  Fx=${d.followX}  Fy=${d.followY}
  S=${d.sepForce}  Sy=${d.sepIy}  dirY=${d.sepDirY}
  Ix=${d.ixRaw}  Iy=${d.iyRaw}
  ix=${d.ix}  iy=${d.iy}  v=${d.speed}
  dx=${d.dx}  dy=${d.dy}  d=${d.sepDist}${d.failed ? "  FAIL" : ""}`;
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
