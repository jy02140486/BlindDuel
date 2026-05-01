/**
 * AIKnowledgeRegistry - 全局 AI 知识缓存系统
 * 自动扫描角色招式的性能数据，提供查询接口给 AIController
 * 使用静态方法 + Map 缓存，避免重复扫描
 */

export class AIKnowledgeRegistry {
    // 全局缓存: characterId -> { versionHash, profile }
    static #cache = new Map();

    /**
     * 获取角色的完整知识档案
     * @param {Character} character - 角色实例
     * @returns {CharacterProfile} 角色知识档案
     */
    static getProfile(character) {
        if (!character || !character.id) {
            console.error("[AI KB] Invalid character provided");
            return null;
        }

        const versionHash = this.#computeVersionHash(character);
        const cached = this.#cache.get(character.id);

        if (cached && cached.versionHash === versionHash) {
            return cached.profile;
        }

        const profile = this.#scanCharacter(character);
        this.#cache.set(character.id, { versionHash, profile });
        return profile;
    }

    /**
     * 清除指定角色的缓存
     */
    static invalidate(characterId) {
        this.#cache.delete(characterId);
    }

    /**
     * 清除所有缓存
     */
    static clear() {
        this.#cache.clear();
    }

    /**
     * 计算版本哈希，用于检测数据是否更新
     */
    static #computeVersionHash(character) {
        const parts = [];
        const clips = character.config?.clips || {};

        for (const [clipName, clipDef] of Object.entries(clips)) {
            const generatedAt = clipDef.colliderData?.source?.generatedAtUtc;
            if (generatedAt) {
                parts.push(`${clipName}:${generatedAt}`);
            }
        }

        // 包含 stateGraph 的引用，确保状态定义变化也能触发重扫
        const stateKeys = Object.keys(character.stateGraph?.states || {}).sort();
        parts.push(`states:${stateKeys.join(",")}`);

        return parts.join("|");
    }

    /**
     * 扫描角色，生成知识档案
     */
    static #scanCharacter(character) {
        const warnings = [];
        const clips = character.config?.clips || {};
        const states = character.stateGraph?.states || {};
        const pxToWorld = character.pxToWorld ?? 0.03;
        const walkSpeed = character.baseWalkSpeed ?? 0;

        const attackProfiles = [];
        const stateDisplacements = {};

        for (const [stateName, stateDef] of Object.entries(states)) {
            const clipName = stateDef.clip;
            const clipDef = clips[clipName];

            if (!clipDef) {
                console.error(`[AI KB] State ${stateName} references unknown clip ${clipName}`);
                continue;
            }

            // 计算位移（所有状态都计算）
            const displacement = this.#computeDisplacement(
                clipDef,
                stateDef,
                stateName,
                warnings
            );
            stateDisplacements[stateName] = displacement;

            // 只扫描攻击状态
            if (stateDef.attackActive === true) {
                const profile = this.#scanAttackState(
                    stateName,
                    stateDef,
                    clipDef,
                    pxToWorld,
                    warnings
                );
                if (profile) {
                    attackProfiles.push(profile);
                }
            }
        }

        if (warnings.length > 0) {
            console.warn(`[AI KB] ${character.id} scan completed with ${warnings.length} warnings:`, warnings);
        }

        return {
            characterId: character.id,
            pxToWorld,
            walkSpeed,
            attacks: attackProfiles,
            movement: {
                walkSpeed,
                stateDisplacements
            }
        };
    }

    /**
     * 扫描单个攻击状态
     */
    static #scanAttackState(stateName, stateDef, clipDef, pxToWorld, warnings) {
        const atlasData = clipDef.atlasData;
        const colliderData = clipDef.colliderData;

        if (!atlasData || !colliderData) {
            warnings.push(`Missing atlas or collider data for state ${stateName}`);
            return null;
        }

        // 获取 atlas 帧的 duration
        const atlasFrames = this.#extractAtlasFrames(atlasData, stateName, warnings);
        const colliderFrames = colliderData.frames || [];

        // 检查帧数
        if (atlasFrames.length < colliderFrames.length) {
            console.error(`[AI KB] Atlas frames (${atlasFrames.length}) < collider frames (${colliderFrames.length}) for ${stateName}, skipping`);
            return null;
        }

        if (atlasFrames.length > colliderFrames.length) {
            warnings.push(`Frame count mismatch: atlas=${atlasFrames.length}, collider=${colliderFrames.length} for ${stateName}`);
        }

        // 确定哪些帧有有效攻击判定
        const attackActiveFrames = stateDef.attackActiveFrames;

        // 找有 weaponbox 的帧，并过滤出有效攻击帧
        const weaponFrames = [];
        for (let i = 0; i < colliderFrames.length; i++) {
            const frame = colliderFrames[i];
            const weaponBoxes = frame.boxes?.filter(b => b.type === "weaponbox") || [];
            if (weaponBoxes.length === 0) continue;

            // 如果定义了 attackActiveFrames，只保留其中的帧
            if (attackActiveFrames !== undefined && !attackActiveFrames.includes(i)) {
                continue;
            }

            weaponFrames.push({
                frameIndex: i,
                durationMs: atlasFrames[i]?.durationMs ?? 100,
                weaponBoxes,
                anchor: frame.anchors?.root,
                frameWidth: frame.frameRect?.w ?? atlasFrames[i]?.w ?? 0,
                frameHeight: frame.frameRect?.h ?? atlasFrames[i]?.h ?? 0
            });
        }

        if (weaponFrames.length === 0) {
            warnings.push(`State ${stateName} has attackActive=true but no active weaponbox frames`);
            return null;
        }

        // 计算时间
        const firstWeaponFrameIndex = weaponFrames[0].frameIndex;
        const lastWeaponFrameIndex = weaponFrames[weaponFrames.length - 1].frameIndex;

        let startupMs = 0;
        for (let i = 0; i < firstWeaponFrameIndex; i++) {
            startupMs += atlasFrames[i]?.durationMs ?? 100;
        }

        let activeMs = 0;
        for (const wf of weaponFrames) {
            activeMs += wf.durationMs;
        }

        let recoveryMs = 0;
        for (let i = lastWeaponFrameIndex + 1; i < colliderFrames.length; i++) {
            recoveryMs += atlasFrames[i]?.durationMs ?? 100;
        }

        const totalMs = startupMs + activeMs + recoveryMs;

        // 判断朝向：用第一帧有 weaponbox 的帧来判断
        const facingRight = this.#detectFacing(weaponFrames[0], warnings);

        // 计算攻击范围
        let globalMaxReach = 0;
        let maxReachBoxId = null;
        const subtypeMaxReach = new Map();

        for (const wf of weaponFrames) {
            const anchor = wf.anchor || this.#fallbackAnchor(wf, warnings);
            if (!anchor) continue;

            for (const box of wf.weaponBoxes) {
                const reach = this.#computeReach(box, anchor, facingRight, pxToWorld);

                // 更新全局最大
                if (reach > globalMaxReach) {
                    globalMaxReach = reach;
                    maxReachBoxId = box.id;
                }

                // 更新 subtype 最大
                const subtype = box.subtype || "weak_blade";
                const current = subtypeMaxReach.get(subtype) || 0;
                if (reach > current) {
                    subtypeMaxReach.set(subtype, reach);
                }
            }
        }

        // 构建 weaponBoxes 数组
        const weaponBoxes = [];
        for (const [subtype, maxReach] of subtypeMaxReach) {
            weaponBoxes.push({ subtype, maxReach });
        }

        // 计算位移
        const frameSpeeds = stateDef.frameSpeeds || [];
        const displacement = this.#computeDisplacementFromSpeeds(
            frameSpeeds,
            atlasFrames,
            stateName,
            warnings
        );

        return {
            stateName,
            timing: {
                startupMs,
                activeMs,
                recoveryMs,
                totalMs
            },
            range: {
                maxReach: globalMaxReach,
                maxReachBoxId,
                facingRight
            },
            displacement,
            weaponBoxes,
            frameSpeeds: [...frameSpeeds]
        };
    }

    /**
     * 从 atlas 数据提取帧信息（按顺序）
     */
    static #extractAtlasFrames(atlasData, stateName, warnings) {
        const frames = [];
        const entries = Object.entries(atlasData?.frames || {});

        // 按 x, y 排序（和 FrameAnimationComponent 一致）
        entries.sort((a, b) => {
            const fa = a[1].frame;
            const fb = b[1].frame;
            if (fa.y !== fb.y) return fa.y - fb.y;
            if (fa.x !== fb.x) return fa.x - fb.x;
            return a[0].localeCompare(b[0]);
        });

        for (const [name, item] of entries) {
            const duration = item.duration;
            if (duration === undefined || duration === null) {
                warnings.push(`Missing duration for frame ${name} in ${stateName}, using 100ms`);
            }
            frames.push({
                name,
                x: item.frame.x,
                y: item.frame.y,
                w: item.frame.w,
                h: item.frame.h,
                durationMs: duration ?? 100
            });
        }

        return frames;
    }

    /**
     * 检测角色朝向
     * 通过比较 weaponbox 和 anchor 的相对位置判断
     */
    static #detectFacing(weaponFrame, warnings) {
        const weaponBox = weaponFrame.weaponBoxes[0];
        const anchor = weaponFrame.anchor;
        if (!anchor) {
            warnings.push("No anchor for facing detection, defaulting to right");
            return true;
        }

        // weaponbox 在 anchor 右侧 -> 朝右
        return weaponBox.cx > anchor.cx;
    }

    /**
     * 计算单个 weaponbox 的向前攻击范围
     */
    static #computeReach(box, anchor, facingRight, pxToWorld) {
        if (facingRight) {
            // 朝右：取 box 右端相对于 anchor 的距离
            const rightEdge = box.cx + box.w / 2;
            return (rightEdge - anchor.cx) * pxToWorld;
        } else {
            // 朝左：取 anchor 到 box 左端的距离
            const leftEdge = box.cx - box.w / 2;
            return (anchor.cx - leftEdge) * pxToWorld;
        }
    }

    /**
     * 计算状态位移
     */
    static #computeDisplacement(clipDef, stateDef, stateName, warnings) {
        const atlasFrames = this.#extractAtlasFrames(clipDef.atlasData, stateName, warnings);
        const frameSpeeds = stateDef.frameSpeeds || [];
        return this.#computeDisplacementFromSpeeds(frameSpeeds, atlasFrames, stateName, warnings);
    }

    /**
     * 根据 frameSpeeds 和 duration 计算位移
     */
    static #computeDisplacementFromSpeeds(frameSpeeds, atlasFrames, stateName, warnings) {
        let displacement = 0;
        const frameCount = atlasFrames.length;

        if (!frameSpeeds || frameSpeeds.length === 0) {
            return 0;
        }

        if (frameSpeeds.length > frameCount) {
            warnings.push(`frameSpeeds length mismatch for ${stateName}: speeds=${frameSpeeds.length}, frames=${frameCount}, truncating`);
        } else if (frameSpeeds.length < frameCount) {
            warnings.push(`frameSpeeds length mismatch for ${stateName}: speeds=${frameSpeeds.length}, frames=${frameCount}, padding with 0`);
        }

        for (let i = 0; i < frameCount; i++) {
            const speed = i < frameSpeeds.length ? frameSpeeds[i] : 0;
            const durationSec = (atlasFrames[i]?.durationMs ?? 100) / 1000;
            displacement += speed * durationSec;
        }

        return displacement;
    }

    /**
     * 备用 anchor（使用帧中心）
     */
    static #fallbackAnchor(weaponFrame, warnings) {
        warnings.push(`Missing anchor for frame ${weaponFrame.frameIndex}, using center`);
        return {
            cx: weaponFrame.frameWidth / 2,
            cy: weaponFrame.frameHeight / 2
        };
    }
}
