# admin_tool.py
import hashlib
import os
import json
import shutil
import sys

# === 关键：导入加密模块和逻辑数据 ===
try:
    import secret_encoder
    # 导入内置效率数据，确保生成的 Key 与逻辑中的指纹一致
    from logic import _INTERNAL_EFFICIENCY_DATA
except ImportError:
    print("❌ 错误: 缺少 secret_encoder.py 或 logic.py，无法生成授权。")
    sys.exit(1)


def generate_hash(order_id):
    return hashlib.sha256(order_id.strip().encode('utf-8')).hexdigest()[:16]


def setup_user(order_id, ops_source_path, config_type):
    """
    order_id: 闲鱼订单号
    ops_source_path: 客户发给你的 operators.json 路径
    config_type: 配置类型
    """
    user_hash = generate_hash(order_id)
    target_dir = os.path.join("user_data", user_hash)

    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    # 1. 读取干员文件内容 (用于生成指纹)
    try:
        with open(ops_source_path, 'r', encoding='utf-8-sig') as f:
            ops_content_str = f.read()
            # 简单校验 JSON 合法性
            json.loads(ops_content_str)
    except Exception as e:
        print(f"❌ 读取源文件失败: {e}")
        return

    # 2. 复制 operators.json 到目标目录
    shutil.copy(ops_source_path, os.path.join(target_dir, "operators.json"))

    # 3. === 核心：生成授权密钥 (License Key) ===
    print("🔐 正在生成数字签名...")
    # 使用 logic 中的内置效率数据 + 用户的干员数据 生成唯一 Key
    license_key = secret_encoder.generate_key_for_main(_INTERNAL_EFFICIENCY_DATA, ops_content_str)

    # 4. 生成 config.json 并写入 Key
    config_templates = {
        "243": {
            "layout": "2-4-3",
            "desc": "243 均衡流 (2赤金/2经验)",
            "product_requirements": {
                "trading_stations": {"LMD": 2},
                "manufacturing_stations": {"Pure Gold": 2, "Battle Record": 2}
            },
            "trading_stations_count": 2,
            "manufacturing_stations_count": 4,
            "Fiammetta": {"enable": True},
            "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
        },
        "243-1": {
            "layout": "2-4-3",
            "desc": "243 搓玉 (2赤金/2源石)",
            "product_requirements": {
                "trading_stations": {"LMD": 1, "Orundum": 1},
                "manufacturing_stations": {"Pure Gold": 2, "Originium Shard": 2},
            },
            "trading_stations_count": 2,
            "manufacturing_stations_count": 4,
            "Fiammetta": {"enable": True},
            "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
        },
        "333": {
            "layout": "3-3-3",
            "desc": "333 搓玉流",
            "product_requirements": {
                "trading_stations": {"LMD": 2, "Orundum": 1},
                "manufacturing_stations": {"Pure Gold": 2, "Originium Shard": 1},
            },
            "trading_stations_count": 3,
            "manufacturing_stations_count": 3,
            "Fiammetta": {"enable": True},
            "drones": {"enable": True, "order": "pre", "targets": ["LMD", "Pure Gold", "LMD"]}
        }
    }

    selected_config = config_templates.get(config_type, config_templates["243"])

    # === 将生成的 Key 存入 Config ===
    selected_config["license_key"] = license_key

    with open(os.path.join(target_dir, "config.json"), "w", encoding='utf-8') as f:
        json.dump(selected_config, f, indent=2, ensure_ascii=False)

    print(f"✅ 用户设置完成!")
    print(f"订单号: {order_id}")
    print(f"Hash Key: {user_hash}")
    print(f"授权密钥: {license_key[:16]}...")
    print(f"数据路径: {target_dir}")


if __name__ == "__main__":
    print("=== MAA 售后数据生成器 (含安全签名) ===")
    oid = input("输入闲鱼订单号: ")
    path = input("operators.json 路径 (直接拖入): ").strip('"')
    c_type = input("配置类型 (243 / 333): ")
    if not c_type: c_type = "243"
    setup_user(oid, path, c_type)