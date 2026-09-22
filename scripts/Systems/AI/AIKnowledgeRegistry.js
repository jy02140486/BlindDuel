/**
 * AIKnowledgeRegistry - 全局 AI 知识缓存系统
 * 自动扫描角色招式的性能数据，提供查询接口给 AIController
 * 使用静态方法 + Map 缓存，避免重复扫描
 */

export class AIKnowledgeRegistry {
    /** Schema version — bump when scan logic changes to force re-scan of cached profiles.
     *  例：v1=初始版本, v2=新增 minReach 贴脸无效区计算 */
    static #SCHEMA_VERSION = 2;

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
     * 导出单个角色的知识档案为 JSON 字符串
     */
    static exportProfile(character) {
        if (!character) return null;
        const profile = this.getProfile(character);
        return profile ? JSON.stringify(profile, null, 2) : null;
    }

    /**
     * 导出所有已缓存的知识档案
     */
    static exportAll() {
        const result = {};
        for (const [charId, entry] of this.#cache) {
            result[charId] = entry.profile;
        }
        return JSON.stringify(result, null, 2);
    }

    /**
     * 计算版本哈希，用于检测数据是否更新
     */
    static #computeVersionHash(character) {
        const parts = [];
        // schema version 确保扫描逻辑变更时强制 re-scan
        parts.push(`sv:${this.#SCHEMA_VERSION}`);

        const clips = character.config?.clips || {};

        for (const [clipName, clipDef] of Object.entries(clips)) {
            const generatedAt = clipDef.colliderData?.source?.generatedAtUtc;
            if (generatedAt) {
                parts.push(`${clipName}:${generatedAt}`);
            }
        }

        // canonical JSON 序列化 stateGraph 整个对象
        // 避免维护白名单，以后加任何字段（characterTraits 等）都自动纳入
        const sg = character.stateGraph || {};
        const stateGraphJson = JSON.stringify(sg, Object.keys(sg).sort());
        parts.push(`sg:${stateGraphJson}`);

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
        const moveSpeed = character.baseMoveSpeed ?? character.baseWalkSpeed ?? 0;

        const attackProfiles = [];
        const dodgeProfiles = [];
        const guardProfiles = [];
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

            // 攻击状态
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
            // 闪避状态
            else if (stateDef.dodgeActive === true) {
                const profile = this.#scanDodgeState(
                    stateName,
                    stateDef,
                    clipDef,
                    displacement,
                    warnings
                );
                if (profile) {
                    dodgeProfiles.push(profile);
                }
            }
            // 格挡状态
            else if (stateDef.guardActive === true) {
                const profile = this.#scanGuardState(
                    stateName,
                    stateDef,
                    clipDef,
                    displacement,
                    warnings,
                    character.stateGraph?.characterTraits || null
                );
                if (profile) {
                    guardProfiles.push(profile);
                }
            }
        }

        if (warnings.length > 0) {
            console.warn(`[AI KB] ${character.id} scan completed with ${warnings.length} warnings:`, warnings);
        }

        // Schema v2+: 打印每个 attack 的 minReach 确认扫描正确
        const _atkSummary = attackProfiles.map(a =>
            `${a.stateName}(minR=${(a.range?.minReach ?? 0).toFixed(2)}, maxR=${a.range?.maxReach?.toFixed(2) ?? "?"})`
        ).join(", ");
        console.log(`[AI KB] ${character.id} re-scan v${this.#SCHEMA_VERSION}: attacks=[${_atkSummary}]`);

        const traits = character.stateGraph?.characterTraits || null;

        return {
            characterId: character.id,
            pxToWorld,
            moveSpeed,
            attacks: attackProfiles,
            dodges: dodgeProfiles,
            guards: guardProfiles,
            movement: {
                moveSpeed,
                stateDisplacements
            },
            traits
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
        let globalMinReach = Infinity; // 所有 weaponbox 离 root 最近的距离（贴脸无效区）
        let maxReachBoxId = null;
        const subtypeMaxReach = new Map();

        for (const wf of weaponFrames) {
            const anchor = wf.anchor || this.#fallbackAnchor(wf, warnings);
            if (!anchor) continue;

            for (const box of wf.weaponBoxes) {
                const reach = this.#computeReach(box, anchor, facingRight, pxToWorld);
                const minReachBox = this.#computeMinReach(box, anchor, facingRight, pxToWorld);

                // 更新全局最大
                if (reach > globalMaxReach) {
                    globalMaxReach = reach;
                    maxReachBoxId = box.id;
                }

                // 更新全局最小（最贴脸的 weaponbox）
                if (minReachBox < globalMinReach) {
                    globalMinReach = minReachBox;
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

        // 计算 activeDisplacement：累加所有非 0 frameSpeeds 帧的位移
        // frameSpeeds 约定：非 0 帧 = weaponbox 活跃期间的位移帧
        // 不依赖 attackActiveFrames 配置
        let activeDisplacement = 0;
        for (let i = 0; i < frameSpeeds.length; i++) {
            const speed = frameSpeeds[i] ?? 0;
            if (speed !== 0) {
                const durMs = atlasFrames[i]?.durationMs ?? 100;
                activeDisplacement += speed * (durMs / 1000);
            }
        }

        return {
            stateName,
            trajectory: stateDef.attackTrajectory ?? null, // "thrust" | "slash" | null
            weight: stateDef.attackWeight ?? null,         // "light" | "heavy" | null
            timing: {
                startupMs,
                activeMs,
                recoveryMs,
                totalMs
            },
            range: {
                maxReach: globalMaxReach,
                minReach: globalMinReach === Infinity ? 0 : globalMinReach,
                maxReachBoxId,
                facingRight
            },
            displacement,
            activeDisplacement,  // 新增：weaponbox 覆盖期间的实际位移
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
     * 计算单个 weaponbox 的向前攻击范围（root 到 weaponbox 远端的距离）
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
     * 计算单个 weaponbox 的贴脸无效区（root 到 weaponbox 近端的距离）
     * 表示：距离 < 此值时，weaponbox 完全覆盖不到对手
     */
    static #computeMinReach(box, anchor, facingRight, pxToWorld) {
        if (facingRight) {
            // 朝右：取 box 左端离 anchor 的距离
            const leftEdge = box.cx - box.w / 2;
            return Math.max(0, leftEdge - anchor.cx) * pxToWorld;
        } else {
            // 朝左：取 anchor 到 box 右端的距离
            const rightEdge = box.cx + box.w / 2;
            return Math.max(0, anchor.cx - rightEdge) * pxToWorld;
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
     * 扫描单个闪避状态
     * dodge 本质是 invincible：期间 hitbox 被过滤，所以不需要 colliderData 算范围
     */
    static #scanDodgeState(stateName, stateDef, clipDef, displacement, warnings) {
        const atlasFrames = this.#extractAtlasFrames(clipDef.atlasData, stateName, warnings);
        if (!atlasFrames || atlasFrames.length === 0) {
            warnings.push(`No atlas frames for dodge state ${stateName}`);
            return null;
        }

        // 计算总时长
        let totalMs = 0;
        for (const frame of atlasFrames) {
            totalMs += frame.durationMs ?? 100;
        }

        const frameSpeeds = stateDef.frameSpeeds || [];

        return {
            stateName,
            timing: { totalMs },
            displacement,
            frameSpeeds: [...frameSpeeds],
            invincible: true
        };
    }

    /**
     * 扫描单个格挡状态
     * guard 不需要 colliderData 算 reach，关键属性是 guardType（克制关系）+ 是否支持 parry 反击
     */
    static #scanGuardState(stateName, stateDef, clipDef, displacement, warnings, characterTraits) {
        const atlasFrames = this.#extractAtlasFrames(clipDef.atlasData, stateName, warnings);
        if (!atlasFrames || atlasFrames.length === 0) {
            warnings.push(`No atlas frames for guard state ${stateName}`);
            return null;
        }

        // 计算总时长
        let totalMs = 0;
        for (const frame of atlasFrames) {
            totalMs += frame.durationMs ?? 100;
        }

        // 判断是否支持 parry 反击：查 characterTraits 而非扫 transition 条件
        const hasCounterTrait = !!characterTraits?.postDefenseCounter?.enabled;

        const frameSpeeds = stateDef.frameSpeeds || [];

        return {
            stateName,
            timing: { totalMs },
            displacement,
            frameSpeeds: [...frameSpeeds],
            guardType: stateDef.guardType ?? null,
            canParry: hasCounterTrait
        };
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
