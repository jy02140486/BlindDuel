import { BaseController } from "./BaseController.js";
import { AIKnowledgeRegistry } from "./AIKnowledgeRegistry.js";

/**
 * AIController - 基础 AI 控制器
 * 控制 rabble_stick（AI 角色），基于距离做出战术决策
 * 场景设定：玩家永远在左，AI 永远在右，AI 始终面向左
 */
export class AIController extends BaseController {
    constructor(character = null, options = {}) {
        super(character);

        // 目标对手（玩家角色）
        this.opponent = options.opponent || null;

        // 决策冷却
        this.attackCooldownMs = options.attackCooldownMs ?? 800;
        this.lastAttackTime = -Infinity;

        // 决策间隔（避免每帧都重新决策）
        this.decisionIntervalMs = options.decisionIntervalMs ?? 100;
        this.decisionAccumulatedMs = 0;

        // 随机扰动
        this.reactionVariance = options.reactionVariance ?? 0.15;

        // 距离缓冲
        this.preferredMinDistance = options.preferredMinDistance ?? 1.0;
        this.preferredMaxDistance = options.preferredMaxDistance ?? 3.0;

        // 当前行为状态
        this.currentBehavior = "idle";

        // 知识库档案（延迟加载）
        this.kbProfile = null;

        // Debug 可视化
        this.debugVisible = options.debugVisible ?? true;
        this.#initDebugVisuals();
    }

    setOpponent(opponent) {
        this.opponent = opponent;
    }

    setDebugVisible(value) {
        this.debugVisible = value;
        if (this.debugMeshes) {
            for (const mesh of this.debugMeshes) {
                mesh.setEnabled(value);
            }
        }
    }

    update(dtMs = 0) {
        if (!this.character || !this.opponent) {
            this.applyToCharacter();
            return;
        }

        // 延迟加载知识库
        if (!this.kbProfile) {
            this.kbProfile = AIKnowledgeRegistry.getProfile(this.character);
        }

        // 累积决策时间
        this.decisionAccumulatedMs += dtMs;
        if (this.decisionAccumulatedMs >= this.decisionIntervalMs) {
            this.decisionAccumulatedMs = 0;
            this.#makeDecision();
        }

        // 更新 debug 可视化位置
        this.#updateDebugVisuals();

        this.applyToCharacter();
    }

    /**
     * 核心决策逻辑
     */
    #makeDecision() {
        const distance = this.#getDistanceToOpponent();
        const now = performance.now();
        const canAttack = now - this.lastAttackTime >= this.attackCooldownMs;

        // 获取攻击范围
        const maxReach = this.#getMaxReach();
        const minReach = this.#getMinReach();

        // 添加随机扰动到距离判断
        const jitteredDistance = distance * (1 + (Math.random() - 0.5) * this.reactionVariance);

        // 决策分段
        if (jitteredDistance > maxReach + 0.5) {
            // 远距离：接近
            this.currentBehavior = "approach";
            this.#approach();
        } else if (jitteredDistance > minReach && jitteredDistance <= maxReach + 0.5) {
            // 中距离：攻击或保持距离
            if (canAttack && Math.random() > 0.3) {
                this.currentBehavior = "attack";
                this.#attack();
            } else {
                this.currentBehavior = "hold";
                this.#holdPosition();
            }
        } else {
            // 近距离：后退或攻击
            if (canAttack && Math.random() > 0.6) {
                this.currentBehavior = "attack";
                this.#attack();
            } else {
                this.currentBehavior = "retreat";
                this.#retreat();
            }
        }
    }

    /**
     * 接近对手（向左走）
     */
    #approach() {
        this.setMoveIntent({ x: -1, y: 0 });
    }

    /**
     * 后退（向右走）
     */
    #retreat() {
        this.setMoveIntent({ x: 1, y: 0 });
    }

    /**
     * 保持位置
     */
    #holdPosition() {
        this.setMoveIntent({ x: 0, y: 0 });
    }

    /**
     * 发起攻击
     */
    #attack() {
        this.setMoveIntent({ x: 0, y: 0 });

        const attack = this.#selectAttack();
        if (attack) {
            this.queueCommand(attack.stateName);
            this.lastAttackTime = performance.now();
        }
    }

    /**
     * 选择攻击招式
     * 简单策略：随机选择一个可用的攻击
     */
    #selectAttack() {
        if (!this.kbProfile || !this.kbProfile.attacks || this.kbProfile.attacks.length === 0) {
            return null;
        }

        const attacks = this.kbProfile.attacks;
        const idx = Math.floor(Math.random() * attacks.length);
        return attacks[idx];
    }

    /**
     * 获取与对手的距离（AI 在右，玩家在左，距离为正）
     */
    #getDistanceToOpponent() {
        const aiX = this.character.root.position.x;
        const playerX = this.opponent.root.position.x;
        return Math.max(0, aiX - playerX);
    }

    /**
     * 获取最大攻击范围
     */
    #getMaxReach() {
        if (!this.kbProfile || !this.kbProfile.attacks) {
            return 0;
        }
        let max = 0;
        for (const attack of this.kbProfile.attacks) {
            if (attack.range && attack.range.maxReach > max) {
                max = attack.range.maxReach;
            }
        }
        return max;
    }

    /**
     * 获取最小攻击范围
     */
    #getMinReach() {
        if (!this.kbProfile || !this.kbProfile.attacks) {
            return 0;
        }
        let min = Infinity;
        for (const attack of this.kbProfile.attacks) {
            if (attack.range && attack.range.maxReach < min) {
                min = attack.range.maxReach;
            }
        }
        return min === Infinity ? 0 : min;
    }

    // ==================== Debug 可视化 ====================

    #initDebugVisuals() {
        if (!this.character || !this.character.scene) return;

        const scene = this.character.scene;
        this.debugMeshes = [];

        // 三个距离圈的颜色：蓝 -> 绿 -> 红
        const colors = [
            new BABYLON.Color3(0.2, 0.5, 1.0),   // 蓝：远距离（接近圈）
            new BABYLON.Color3(0.2, 0.8, 0.4),   // 绿：中距离（攻击圈）
            new BABYLON.Color3(1.0, 0.3, 0.2)    // 红：近距离（危险圈）
        ];

        for (let i = 0; i < 3; i++) {
            const material = new BABYLON.StandardMaterial(`ai_debug_ring_${i}`, scene);
            material.diffuseColor = colors[i];
            material.emissiveColor = colors[i];
            material.alpha = 0.15;
            material.backFaceCulling = false;
            material.disableLighting = true;
            material.wireframe = true;

            const disc = BABYLON.MeshBuilder.CreateDisc(`ai_debug_disc_${i}`, {
                radius: 1,
                tessellation: 64
            }, scene);
            disc.material = material;
            disc.rotation.x = Math.PI / 2;
            disc.setEnabled(this.debugVisible);

            this.debugMeshes.push(disc);
        }
    }

    #updateDebugVisuals() {
        if (!this.character || !this.debugMeshes || this.debugMeshes.length === 0) return;

        const pos = this.character.root.position;
        const maxReach = this.#getMaxReach();
        const minReach = this.#getMinReach();

        // 三个圈的半径
        const radii = [
            maxReach + 0.5,  // 蓝圈：远距离边界
            maxReach,        // 绿圈：最大攻击范围
            minReach         // 红圈：最小攻击范围
        ];

        for (let i = 0; i < 3; i++) {
            const mesh = this.debugMeshes[i];
            if (!mesh) continue;

            mesh.position.x = pos.x;
            mesh.position.y = pos.y + 0.01;
            mesh.position.z = pos.z;
            mesh.scaling.x = radii[i];
            mesh.scaling.y = radii[i];
            mesh.setEnabled(this.debugVisible);
        }
    }

    dispose() {
        if (this.debugMeshes) {
            for (const mesh of this.debugMeshes) {
                if (mesh) mesh.dispose();
            }
            this.debugMeshes = null;
        }
        super.dispose();
    }
}
