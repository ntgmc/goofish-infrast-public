#!/usr/bin/env python3
"""Generate inventory item icons and turn their green screen into alpha PNGs.

The script never stores credentials. Set KRILL_AI_API_KEY in the environment before
running a non-dry command. Existing assets are skipped unless --force is supplied.
"""

from __future__ import annotations

import argparse
import base64
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ITEM_ASSET_DIR = ROOT / "public" / "assets" / "items"
CHROMA_KEY_RELATIVE_PATH = Path("skills") / ".system" / "imagegen" / "scripts" / "remove_chroma_key.py"
DEFAULT_BASE_URL = "https://api.krill-ai.net/v1"
DEFAULT_MODEL = "gpt-image-2"
FINAL_SIZE = 256


@dataclass(frozen=True)
class IconSpec:
    code: str
    filename: str
    asset_type: str
    primary_request: str
    subject: str
    focus_rule: str
    avoid_extra: str


COMMON_STYLE = """
Style/medium:
现代网页游戏 UI 图标，扁平化矢量插画风格，轻微 2.5D 微质感，匹配精致移动端游戏道具图标。使用大色块、粗而干净的深色轮廓、少量柔和渐变、非常克制的内阴影和边缘高光。整体精致但不写实，避免复杂纹理。

Composition/framing:
正面视角，只允许约 8–12 度轻微倾斜，不使用强烈透视。主体严格居中，占画布面积约 72%–78%，四周保留约 12%–14% 的安全留白，任何边缘都不能被裁切。构图紧凑、单一、稳定，适合缩小为 64×64 和 40×40 像素。

Lighting/mood:
柔和、干净的正面光照，轻微边缘高光，克制的可信科技感。不要外部投影、接触阴影、地面、环境反射、复杂粒子或强烈霓虹光晕。

Color palette:
主体使用深皇家蓝和藏青色，核心功能符号使用高亮青蓝色，边缘和少量关键节点使用克制的暖金色点缀。整体高对比、清晰、现代。不要使用大面积紫色、红色或绿色。

Scene/backdrop:
使用完全平坦、纯色、均匀的 #00FF00 色度键背景，以便后续移除为透明背景。背景必须是单一纯色，没有渐变、阴影、纹理、颗粒、光晕、反射、地面或任何照明变化。道具主体内部绝对不要出现 #00FF00 或接近的亮绿色。

Text:
不要生成任何文字。不要出现汉字、英文字母、数字、序列号、二维码或伪文字。

Constraints:
只绘制一个完整道具。轮廓粗细统一，边缘干净利落。不要生成图标边框、背包格子、品质底板、角色、手、场景或额外道具。无文字、无品牌标志、无商标、无水印。
""".strip()


ICON_SPECS = (
    IconSpec(
        code="priority_compute_coupon",
        filename="priority-compute-coupon.png",
        asset_type="website backpack game UI consumable item icon",
        primary_request="为网页背包系统绘制一枚“优先计算券”游戏道具图标，作用是让一次主排班任务进入最高优先队列。第一视觉含义是“票券 + 最高优先级 + 快速进入计算队列”。",
        subject="画面中只有一张独立的现代科技票券：清晰完整的矩形剪影，四角略微切角，两侧带简洁半圆形票根缺口，边缘略厚。票券中央放置三枚粗壮、简洁、向上排列的加速箭头或 V 形箭头，最上方箭头最明亮；箭头周围只保留极少量简化电路线节点。票券右下角压印一个小型圆形回转箭头徽记，作为任务失败返还的次要提示。",
        focus_rule="三层向上箭头必须是最强视觉焦点；右下角回转箭头只能是次要符号，不能抢夺中央注意力。",
        avoid_extra="写实纸张、古代羊皮卷轴、魔法卷轴、纸币、银行卡、登机牌、复杂电路板、微小装饰、密集线条、华丽符文、星星、皇冠、翅膀、火焰、闪电爆炸、速度线背景、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="reorder_check_coupon",
        filename="reorder-check-coupon.png",
        asset_type="website backpack game UI consumable item icon",
        primary_request="为网页背包系统绘制一枚“变化预判券”游戏道具图标，作用是在免费月度变化影响预判次数用尽后额外执行一次预判。第一视觉含义是“变化趋势 + 检查验证”。",
        subject="画面中只有一张独立的现代科技票券：完整矩形轮廓、四角略微切角、两侧简洁半圆票根缺口、边缘略厚。票券中央放置两条粗壮、简洁、彼此交叉或上下交换方向的箭头，形成清晰的顺序调整含义；箭头旁边保留一个小型但可辨认的圆形检查徽记，徽记内是简化勾选符号。箭头周围只可保留极少量简化科技线路节点。",
        focus_rule="重新排序箭头必须是最强视觉焦点，圆形检查徽记只能作为第二视觉层级。",
        avoid_extra="写实纸张、古代羊皮卷轴、魔法卷轴、纸币、银行卡、登机牌、复杂流程图、密集网格、表格、复杂电路板、微小装饰、华丽符文、星星、皇冠、翅膀、火焰、闪电爆炸、速度线背景、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="scenario_simulation_coupon",
        filename="scenario-simulation-coupon.png",
        asset_type="website backpack game UI consumable item icon",
        primary_request="为网页背包系统绘制一枚“情景推演券”游戏道具图标，作用是让缺少永久情景比较权限的档案运行一次情景推演。第一视觉含义是“一个输入分叉为多个可比较方案”。",
        subject="画面中只有一张独立的现代科技票券：完整矩形轮廓、四角略微切角、两侧简洁半圆票根缺口、边缘略厚。票券中央放置一条粗壮主线路，从单一节点进入，在中央清晰分叉为三条等距、粗而简洁的路线，分别通向三个简化节点或抽象情景模块。每个终点只允许极简几何节点或小型抽象面板。",
        focus_rule="单一输入与三条分叉路线必须立即可辨；分叉线路必须是最强视觉焦点。",
        avoid_extra="写实纸张、古代羊皮卷轴、魔法卷轴、纸币、银行卡、地图、真实道路、人物、建筑、复杂流程图、密集线路、复杂电路板、微小装饰、数据表、柱状图、华丽符文、星星、皇冠、翅膀、火焰、闪电爆炸、速度线背景、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="training_diagnosis_coupon",
        filename="training-diagnosis-coupon.png",
        asset_type="website backpack game UI consumable item icon",
        primary_request="为网页背包系统绘制一枚“练度诊断券”游戏道具图标，作用是在一次主排班中启用升级建议、升级 ROI 和养成成本诊断。第一视觉含义是“等级成长分析 + 精确诊断”。",
        subject="画面中只有一张独立的现代科技票券：完整矩形轮廓、四角略微切角、两侧简洁半圆票根缺口、边缘略厚。票券中央放置三个由低到高的粗壮等级条或成长柱形，并在右侧略微覆盖一个大而简洁的放大镜。放大镜内部只有一条简化诊断脉冲线或勾选波形。不要画医疗标志、人体、角色头像、数值刻度或复杂报表。",
        focus_rule="递增等级条是最强视觉焦点，放大镜是第二焦点，镜内诊断符号仅为第三层级。",
        avoid_extra="写实纸张、古代羊皮卷轴、医疗病历、医院图标、听诊器、复杂柱状图、表格、密集数据、复杂电路板、华丽符文、星星、皇冠、翅膀、火焰、闪电爆炸、速度线背景、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="additional_recompute_coupon",
        filename="additional-recompute-coupon.png",
        asset_type="website backpack game UI consumable item icon",
        primary_request="为网页背包系统保留一枚历史“追加重算券”游戏道具图标。当前免费预览已可按页面规则重新生成完整排班，此道具不再发放。第一视觉含义保持为“再计算一次 + 历史纪念”。",
        subject="画面中只有一张独立的现代科技票券：完整矩形轮廓、四角略微切角、两侧简洁半圆票根缺口、边缘略厚。票券中央放置一个极其醒目的粗壮圆形回转箭头，几乎形成完整圆环但保留清晰箭头尖端。圆环中心或右下侧放置一个高亮青蓝加号。周围只可保留极少量简化计算节点。",
        focus_rule="粗壮圆形回转箭头必须是最强视觉焦点，加号清晰但只能作为第二焦点。",
        avoid_extra="写实纸张、古代羊皮卷轴、纸币、银行卡、普通网页刷新图标、多个循环符号、复杂时钟、复杂电路板、微小装饰、华丽符文、星星、皇冠、翅膀、火焰、闪电爆炸、速度线背景、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="plan_capacity_certificate",
        filename="plan-capacity-certificate.png",
        asset_type="website backpack game UI permanent capacity-upgrade item icon",
        primary_request="为网页背包系统绘制一枚“方案扩容证”游戏道具图标，作用是让指定档案的保存方案槽位永久增加 1。第一视觉含义是“可保存更多方案卡”。",
        subject="画面中只有一张独立的现代科技权限证书或方案卡，不使用票券票根缺口。主体有完整的略带切角的权限卡剪影，边缘略厚。中央放置两到三张前后叠放的方案卡片，后方卡片只露出清晰边缘，前方主卡最完整；主卡右上角或中央放置醒目的高亮青蓝加号。卡片内部最多保留一两条粗线或简化模块。",
        focus_rule="叠放卡片是最强视觉焦点，加号是第二焦点，卡片内的抽象模块不能抢夺注意力。",
        avoid_extra="银行卡、纸币、现实身份证、纸张合同、古代证书、文件夹、复杂网页界面、表格、密集文本行、数字、复杂电路板、微小装饰、华丽符文、星星、皇冠、翅膀、火焰、方形底板。",
    ),
    IconSpec(
        code="history_capacity_certificate",
        filename="history-capacity-certificate.png",
        asset_type="website backpack game UI permanent capacity-upgrade item icon",
        primary_request="为网页背包系统绘制一枚“历史档案扩容证”游戏道具图标，作用是让指定档案的滚动结果历史槽位永久增加 1。第一视觉含义是“保存更多过去的结果记录”。",
        subject="画面中只有一张独立的现代科技权限证书或档案卡，不使用票券票根缺口。中央放置三层前后叠放的历史记录卡片或文件页；主卡旁边保留小型简洁时钟轮廓，时钟仅有圆形外框和两根粗短指针；主卡右上侧放置高亮青蓝加号。卡片内部最多保留一两条粗横线或单一结果节点。",
        focus_rule="叠放历史卡片是最强视觉焦点，加号是第二焦点，时钟只能作为第三层级的历史提示。",
        avoid_extra="银行卡、纸币、现实身份证、传统纸质档案、古老卷宗、日历数字、日期、复杂时钟、复杂网页界面、表格、密集文字行、复杂电路板、华丽符文、星星、皇冠、翅膀、火焰、方形底板。",
    ),
    IconSpec(
        code="result_archive_folder",
        filename="result-archive-folder.png",
        asset_type="website backpack game UI permanent archive-capacity item icon",
        primary_request="为网页背包系统绘制一枚“结果封存夹”游戏道具图标，作用是让指定档案的结果封存区永久增加一个槽位。第一视觉含义是“安全封存一个结果”。",
        subject="画面中只有一个独立的现代科技封存文件夹：清晰、完整、可一眼识别的文件夹剪影，上方有简洁标签页，主体略厚。文件夹内部只略露出一张结果卡片的上边缘或右侧边缘。文件夹中央或右下侧放置极其明确的金色封条、青蓝闭合扣或简化封存扣。",
        focus_rule="文件夹剪影必须是最强视觉焦点，封扣是第二焦点，露出的结果卡片只能作为第三层级。",
        avoid_extra="传统牛皮纸档案袋、书本、行李箱、现实办公文件夹、真实挂锁、密码锁、盾牌、军事徽章、复杂纸张纹理、多个文件夹、密集文件页、复杂电路板、华丽符文、星星、皇冠、翅膀、火焰、方形底板。",
    ),
    IconSpec(
        code="maa_export_trial_coupon",
        filename="maa-export-trial-coupon.png",
        asset_type="website backpack game UI consumable export-permission item icon",
        primary_request="为网页背包系统绘制一枚“导出体验券”游戏道具图标，作用是在缺少永久导出权限时导出一次指定结果。第一视觉含义是“文件向外导出 + 一次权限”。",
        subject="画面中只有一张独立的现代科技票券或权限卡：完整矩形剪影、略带切角、边缘略厚。中央放置一张简化抽象文件页，只有清晰纸页轮廓与一个折角；从文件页向右侧或右上方延伸一支粗壮醒目的向外导出箭头。箭头终点可保留极小的简化端口节点。",
        focus_rule="文件页与向外导出箭头共同构成主视觉；箭头必须表达向外导出，不能读成下载、上传或分享。",
        avoid_extra="银行卡、纸币、现实护照、登机牌、传统羊皮卷、真实文档、文字文件、文件扩展名、云上传图标、云下载图标、分享节点图、复杂网络图、复杂电路板、华丽符文、星星、皇冠、翅膀、火焰、方形底板。",
    ),
    IconSpec(
        code="newcomer_supply_pack",
        filename="newcomer-supply-pack.png",
        asset_type="website backpack game UI gift-pack item icon",
        primary_request="为网页背包系统绘制一枚“新人补给包”游戏道具图标，这是一个可手动开启的礼包。第一视觉含义是“欢迎用户的多种实用补给”。",
        subject="画面中只有一个独立的现代科技补给箱：深蓝硬质箱轮廓，箱盖与箱身有明确分层，正面有简洁金色锁扣。箱盖或前方可展示三个极简、整合在箱体内的小补给符号：一张科技票券、一张权限卡和一个小型芯片或小罐形符号。箱体中央可保留简洁高亮青蓝核心标记。",
        focus_rule="补给箱主体必须是最强视觉焦点，金色锁扣是第二焦点，三种小补给符号只能用作第三层级的内容暗示。",
        avoid_extra="古代宝箱、木箱、旅行箱、军用弹药箱、现实纸箱、礼物蝴蝶结、真实快递包装、角色、人物、新人文字、欢迎语、星星、皇冠、翅膀、火焰、闪电爆炸、粒子喷射、复杂电路板、华丽符文、强烈霓虹光晕、厚重 3D 倒角、方形底板。",
    ),
    IconSpec(
        code="lifetime_profile_voucher",
        filename="lifetime-profile-voucher.png",
        asset_type="website backpack game UI permanent account-license voucher icon",
        primary_request="为网页背包系统绘制一枚“终身版兑换 CDK”游戏道具图标。用户先把它放入背包，之后绑定森空岛账号并创建或升级终身档案。第一视觉含义是“科技票券凭证 + 永久有效 + 账号绑定”。",
        subject="画面中只有一张独立的现代科技票券或权限凭证：完整矩形剪影、四角略微切角、两侧带简洁半圆票根缺口、边缘略厚。票券中央放置一个极其清晰、粗壮、连续的无限符号；无限符号后方或内部只允许保留一个极简的圆形账号连接节点，表达绑定但不能画人物头像。无限符号使用高亮青蓝核心与克制金色边缘。",
        focus_rule="无限符号必须是绝对主视觉并在 40×40 像素下仍清晰；账号连接节点只能作为第二层级，票券轮廓作为稳定外形。",
        avoid_extra="现金、纸币、银行卡、信用卡、会员卡、现实身份证、护照、登机牌、二维码、序列号、日期、文字、数字、人物头像、锁链、婚戒、沙漏、时钟、日历、皇冠、翅膀、魔法卷轴、复杂电路板、密集装饰、方形底板。",
    ),
    IconSpec(
        code="limited_profile_voucher",
        filename="limited-profile-voucher.png",
        asset_type="website backpack game UI time-limited account-license voucher icon",
        primary_request="为网页背包系统绘制一枚“限时 CDK”游戏道具图标。它用于给已绑定森空岛的免费预览档案临时激活高级权限，并在活动结束时失效。第一视觉含义是“科技票券凭证 + 明确限时 + 倒计时”。",
        subject="画面中只有一张与终身版同系列的现代科技票券：完整矩形剪影、四角略微切角、两侧带简洁半圆票根缺口、边缘略厚。票券中央放置一个大而简洁的圆形倒计时环或时钟轮廓，只有两根粗短指针；圆环右上方留出一个小型缺口与单一高亮节点，暗示时间正在流逝。使用高亮青蓝核心、深皇家蓝主体和少量暖金色边缘。",
        focus_rule="圆形倒计时环必须是绝对主视觉并在 40×40 像素下仍清晰；指针和单一高亮节点是第二层级，不能出现可读数字或日期。",
        avoid_extra="现金、纸币、银行卡、信用卡、现实身份证、护照、登机牌、二维码、序列号、文字、数字、具体日期、日历页、沙漏、闹钟铃铛、人物头像、无限符号、皇冠、翅膀、魔法卷轴、复杂电路板、密集装饰、方形底板。",
    ),
    IconSpec(
        code="generic_gift_pack",
        filename="generic-gift-pack.png",
        asset_type="website backpack game UI configurable gift-pack item icon",
        primary_request="为网页背包系统绘制一枚“通用自定义礼包”游戏道具图标。这是后台可配置内容、可发放给用户并由用户手动开启的中性礼包。第一视觉含义是“可配置的科技礼包”，不能带新人、欢迎、成长、节日或特定活动含义。",
        subject="画面中只有一个独立的中性现代科技礼包箱：清晰完整、带少量切角的深蓝硬质箱轮廓，箱盖与箱身有明确分层，正面有简洁暖金色锁扣。箱体正中央放置醒目的高亮青蓝六边形标记，六边形内部是一个极简抽象包裹、盒子或折叠封包符号。只能使用一个中心礼包符号。",
        focus_rule="礼包箱剪影必须是最强视觉焦点，青蓝中心六边形标记是第二焦点，金色锁扣是第三焦点。",
        avoid_extra="古代宝箱、木箱、旅行箱、军用弹药箱、现实纸箱、传统礼物盒、蝴蝶结、新人标识、欢迎标识、节日元素、生日元素、多道具组合、星星、皇冠、翅膀、火焰、闪电爆炸、粒子喷射、复杂电路板、华丽符文、厚重 3D 倒角、方形底板。",
    ),
)


def build_prompt(spec: IconSpec) -> str:
    return "\n\n".join(
        (
            "Use case: stylized-concept",
            f"Asset type: {spec.asset_type}",
            f"Primary request:\n{spec.primary_request}",
            f"Subject:\n{spec.subject}",
            f"Focus hierarchy:\n{spec.focus_rule}",
            COMMON_STYLE,
            f"Avoid:\n{spec.avoid_extra} 无投射阴影、无接触阴影、无场景背景、无额外道具、无文字、无数字、无二维码、无 logo、无 watermark。",
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", action="append", choices=[spec.code for spec in ICON_SPECS], help="Generate only one item code. Repeat to select multiple icons.")
    parser.add_argument("--dry-run", action="store_true", help="Show the planned output files without calling the image API.")
    parser.add_argument("--check-helper", action="store_true", help="Resolve and print the chroma-key helper path without calling the image API.")
    parser.add_argument("--force", action="store_true", help="Regenerate an existing final asset.")
    parser.add_argument("--base-url", default=os.environ.get("KRILL_AI_BASE_URL", DEFAULT_BASE_URL), help="OpenAI-compatible API base URL.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Image generation model.")
    return parser.parse_args()


def selected_specs(codes: list[str] | None) -> tuple[IconSpec, ...]:
    if not codes:
        return ICON_SPECS
    requested = set(codes)
    return tuple(spec for spec in ICON_SPECS if spec.code in requested)


def create_client(base_url: str) -> OpenAI:
    api_key = os.environ.get("KRILL_AI_API_KEY")
    if not api_key:
        raise RuntimeError("KRILL_AI_API_KEY is not set. Set it in the environment; never add it to this script or a repository file.")
    return OpenAI(base_url=base_url, api_key=api_key)


def resolve_chroma_key_script() -> Path:
    codex_roots: list[Path] = []
    configured_home = os.environ.get("CODEX_HOME")
    if configured_home:
        codex_roots.append(Path(configured_home).expanduser())
    codex_roots.append(Path.home() / ".codex")

    mount_root = Path("/mnt")
    if mount_root.is_dir():
        for drive in sorted(mount_root.iterdir()):
            users_root = drive / "Users"
            if not users_root.is_dir():
                continue
            try:
                codex_roots.extend(user_home / ".codex" for user_home in sorted(users_root.iterdir()))
            except OSError:
                continue

    checked: list[Path] = []
    seen: set[Path] = set()
    for codex_root in codex_roots:
        candidate = codex_root / CHROMA_KEY_RELATIVE_PATH
        if candidate in seen:
            continue
        seen.add(candidate)
        checked.append(candidate)
        if candidate.is_file():
            return candidate

    checked_paths = "\n  - ".join(str(path) for path in checked)
    raise RuntimeError(f"Chroma-key helper was not found. Checked:\n  - {checked_paths}")


def decode_image(response: object) -> bytes:
    data = getattr(response, "data", None)
    if not data:
        raise RuntimeError("The image API returned no image data.")
    encoded = getattr(data[0], "b64_json", None)
    if not encoded:
        raise RuntimeError("The image API did not return b64_json; this generator intentionally does not fetch untrusted image URLs.")
    return base64.b64decode(encoded)


def remove_chroma_and_validate(source: Path, destination: Path, force: bool, chroma_key_script: Path) -> dict[str, object]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    chroma_command = [
        sys.executable,
        str(chroma_key_script),
        "--input",
        str(source),
        "--out",
        str(destination),
        "--auto-key",
        "border",
        "--soft-matte",
        "--transparent-threshold",
        "12",
        "--opaque-threshold",
        "220",
        "--despill",
    ]
    if force:
        chroma_command.append("--force")
    subprocess.run(chroma_command, check=True)

    image = Image.open(destination).convert("RGBA").resize((FINAL_SIZE, FINAL_SIZE), Image.Resampling.LANCZOS)
    image.save(destination, optimize=True)
    final = Image.open(destination).convert("RGBA")
    alpha = final.getchannel("A")
    corners = tuple(alpha.getpixel(point) for point in ((0, 0), (FINAL_SIZE - 1, 0), (0, FINAL_SIZE - 1), (FINAL_SIZE - 1, FINAL_SIZE - 1)))
    if corners != (0, 0, 0, 0):
        raise RuntimeError(f"{destination.name} does not have transparent corners: {corners}")

    visible_green = sum(
        1
        for red, green, blue, opacity in final.getdata()
        if opacity > 16 and green > 180 and green > red * 1.45 and green > blue * 1.25
    )
    if visible_green:
        raise RuntimeError(f"{destination.name} retains {visible_green} visible green-screen pixels.")

    preview_bounds: dict[str, tuple[int, int, int, int] | None] = {}
    for size in (64, 40):
        preview_alpha = final.resize((size, size), Image.Resampling.LANCZOS).getchannel("A")
        visible = preview_alpha.point(lambda value: 255 if value > 16 else 0)
        bounds = visible.getbbox()
        if not bounds or bounds[0] == 0 or bounds[1] == 0 or bounds[2] == size or bounds[3] == size:
            raise RuntimeError(f"{destination.name} lacks a visible safety margin at {size}px: {bounds}")
        preview_bounds[f"{size}px"] = bounds

    return {
        "size": final.size,
        "bytes": destination.stat().st_size,
        "preview_bounds": preview_bounds,
    }


def generate_one(client: OpenAI, spec: IconSpec, model: str, force: bool, chroma_key_script: Path) -> None:
    destination = ITEM_ASSET_DIR / spec.filename
    if destination.exists() and not force:
        print(f"SKIP {spec.code}: {destination.relative_to(ROOT)} already exists")
        return

    print(f"GENERATE {spec.code} -> {destination.relative_to(ROOT)}")
    response = client.images.generate(
        model=model,
        prompt=build_prompt(spec),
        size="1024x1024",
        quality="high",
    )
    with tempfile.TemporaryDirectory(prefix=f"{spec.code}-") as temp_dir:
        source = Path(temp_dir) / f"{spec.code}-source.png"
        source.write_bytes(decode_image(response))
        metadata = remove_chroma_and_validate(source, destination, force, chroma_key_script)
    print(f"READY {spec.code}: {metadata}")


def main() -> int:
    args = parse_args()
    specs = selected_specs(args.only)
    if args.check_helper:
        print(f"CHROMA {resolve_chroma_key_script()}")
        return 0
    if args.dry_run:
        for spec in specs:
            destination = ITEM_ASSET_DIR / spec.filename
            action = "replace" if destination.exists() and args.force else "skip" if destination.exists() else "create"
            print(f"{action.upper():7} {spec.code:32} {destination.relative_to(ROOT)}")
        return 0

    chroma_key_script = resolve_chroma_key_script()
    client = create_client(args.base_url)
    for spec in specs:
        generate_one(client, spec, args.model, args.force, chroma_key_script)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Keep API diagnostics concise and avoid printing secrets.
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
