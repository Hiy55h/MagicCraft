import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const STATUS = "magic:status";
const WAND = "magic:super_stick";
const attrs = ["電気", "火", "水", "空気"];
const selected = new Map();
const floating = new Set();

function tell(p, msg) {
  try {
    p.sendMessage(`§b[MagicCraft]§r ${msg}`);
  } catch {}
}

async function showStatus(p) {
  const form = new ActionFormData()
    .title("ステータス")
    .body(`現在の魔法属性：${selected.get(p.id) ?? "未選択"}`)
    .button("魔法属性");

  try {
    const r = await form.show(p);
    if (r.canceled || r.selection !== 0) return;

    const f = new ActionFormData()
      .title("魔法属性")
      .body("使いたい属性を選んでね");

    for (const a of attrs) f.button(a);

    const q = await f.show(p);
    if (q.canceled || q.selection === undefined) return;

    selected.set(p.id, attrs[q.selection]);
    if (floating.has(p.id)) {
      floating.delete(p.id);
      try { p.removeEffect("levitation"); } catch {}
    }
    tell(p, `属性を「${attrs[q.selection]}」に設定したよ！`);
  } catch {}
}

function giveStatus(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    for (let i = 0; i < inv.size; i++) {
      if (inv.getItem(i)?.typeId === STATUS) return true;
    }

    inv.addItem(new ItemStack(STATUS, 1));
    return true;
  } catch {
    return false;
  }
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;

  system.runTimeout(() => {
    if (!giveStatus(player)) {
      system.runTimeout(() => giveStatus(player), 40);
    }
  }, 20);
});

// 属性の常時効果
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    const a = selected.get(p.id);
    if (!a) continue;

    try {
      if (a === "電気") {
        p.addEffect("speed", 40, {
          amplifier: 0,
          showParticles: false
        });
      } else if (a === "火") {
        p.addEffect("fire_resistance", 40, {
          amplifier: 0,
          showParticles: false
        });

        const loc = p.location;

        for (let i = 0; i < 12; i++) {
          const t = i * Math.PI / 6;

          p.dimension.spawnParticle("minecraft:basic_flame_particle", {
            x: loc.x + Math.cos(t) * 1.5,
            y: loc.y + 0.15,
            z: loc.z + Math.sin(t) * 1.5
          });
        }
      } else if (a === "水") {
        p.addEffect("water_breathing", 40, {
          amplifier: 0,
          showParticles: false
        });
        p.addEffect("fire_resistance", 40, {
          amplifier: 0,
          showParticles: false
        });
        p.addEffect("slow_falling", 40, {
          amplifier: 0,
          showParticles: false
        });

        if (p.isSwimming) {
          p.addEffect("haste", 40, {
            amplifier: 1,
            showParticles: false
          });
        }
      } else if (a === "空気") {
        if (floating.has(p.id)) {
          p.addEffect("levitation", 40, {
            amplifier: 0,
            showParticles: false
          });
        } else {
          p.addEffect("slow_falling", 40, {
            amplifier: 0,
            showParticles: false
          });
        }
      }
    } catch {}
  }
}, 20);

// 視線の先にいる対象を取得
function findTarget(p, maxDistance = 12) {
  try {
    const hits = p.getEntitiesFromViewDirection({ maxDistance });

    for (const hit of hits) {
      const e = hit.entity;

      if (!e || e.id === p.id) continue;
      if (e.typeId === "minecraft:player") continue;
      if (e.typeId === "minecraft:item") continue;
      if (e.typeId === "minecraft:xp_orb") continue;

      return e;
    }
  } catch {}

  return undefined;
}

// 杖を使用したとき
world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
  const p = source;

  if (!p || p.typeId !== "minecraft:player") return;

  if (itemStack.typeId === STATUS) {
    showStatus(p);
    return;
  }

  if (itemStack.typeId !== WAND) return;

  const a = selected.get(p.id);

  if (!a) {
    tell(p, "先にステータスから魔法属性を選んでね");
    return;
  }

  try {
    const dim = p.dimension;

    // 電気属性
    if (a === "電気") {
      const target = findTarget(p);

      if (!target) {
        tell(p, "前方に対象が見つからないよ");
        return;
      }

      dim.spawnEntity("minecraft:lightning_bolt", target.location);
      tell(p, "雷を落とした！");
    }

    // 火属性：対象の足元にマグマを一瞬だけ設置
    else if (a === "火") {
      const target = findTarget(p);

      if (!target) {
        tell(p, "前方に対象が見つからないよ");
        return;
      }

      const loc = target.location;
      const pos = {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z)
      };

      const block = dim.getBlock(pos);

      if (!block || !block.isAir) {
        tell(p, "対象の足元にマグマを置ける空間がないよ");
        return;
      }

      block.setType("minecraft:lava");

      // 2tick後にマグマを消す
      system.runTimeout(() => {
        try {
          const current = dim.getBlock(pos);

          if (current && current.typeId === "minecraft:lava") {
            current.setType("minecraft:air");
          }
        } catch {}
      }, 2);

      tell(p, "火の魔法！マグマが一瞬出現した！");
    }

    // 水属性
    else if (a === "水") {
      const target = findTarget(p);

      if (!target) {
        tell(p, "前方に対象が見つからないよ");
        return;
      }

      const x = Math.floor(target.location.x);
      const y = Math.floor(target.location.y);
      const z = Math.floor(target.location.z);

      const feet = dim.getBlock({ x, y, z });
      const head = dim.getBlock({ x, y: y + 1, z });

      if (!feet || !head) {
        tell(p, "水を置ける場所が見つからないよ");
        return;
      }

      feet.setType("minecraft:water");
      head.setType("minecraft:water");

      tell(p, "対象の足元と頭上に水を置いた！");
    }

    // 空気属性：杖を使うたびに浮遊モードを切り替え
    else if (a === "空気") {
      if (floating.has(p.id)) {
        floating.delete(p.id);
        try { p.removeEffect("levitation"); } catch {}
        tell(p, "浮遊モード OFF");
      } else {
        floating.add(p.id);
        try {
          p.addEffect("levitation", 40, {
            amplifier: 0,
            showParticles: false
          });
        } catch {}
        tell(p, "浮遊モード ON");
      }

      try {
        const loc = p.location;
        for (let i = 0; i < 12; i++) {
          const t = i * Math.PI / 6;
          dim.spawnParticle("minecraft:cloud", {
            x: loc.x + Math.cos(t) * 0.7,
            y: loc.y + 0.8,
            z: loc.z + Math.sin(t) * 0.7
          });
        }
      } catch {}
    }
  } catch (e) {
    tell(p, "魔法を使えなかったよ");
  }
});
```
