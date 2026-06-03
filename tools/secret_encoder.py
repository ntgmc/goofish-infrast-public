# secret_encoder.py
import json


class ChaosCipher:
    def __init__(self):
        # === 混淆矩阵 (S-Box) ===
        # 这些是随机生成的十六进制数，充当“私钥”字典
        self._S_BOX = [
            0xA3, 0x1F, 0x8D, 0x44, 0x92, 0xCC, 0x5B, 0x7E,
            0x21, 0xF4, 0x69, 0xB0, 0xD7, 0x38, 0xE5, 0x06,
            0xFA, 0x2C, 0x53, 0x88, 0xBF, 0xE1, 0x14, 0x49,
            0x7A, 0xAD, 0xDE, 0x05, 0x36, 0x67, 0x90, 0xC3
        ]
        # === 移位因子 ===
        self._ROTATE_SEED = 13

    def _rol(self, val, r_bits, max_bits=32):
        """循环左移"""
        return (val << r_bits % max_bits) & (2 ** max_bits - 1) | \
            ((val & (2 ** max_bits - 1)) >> (max_bits - (r_bits % max_bits)))

    def calculate_token(self, data_content):
        """
        生成令牌：
        输入字符串 -> 转字节 -> 结合S-BOX进行非线性变换 -> 异或累加 -> 转Hex
        """
        if not isinstance(data_content, bytes):
            data_content = data_content.encode('utf-8')

        h_val = 0x12345678  # 初始向量 IV

        for i, byte in enumerate(data_content):
            # 1. 查表替换 (Substitution)
            s_val = self._S_BOX[(byte ^ i) % len(self._S_BOX)]

            # 2. 异或混淆 (XOR Confusion)
            h_val ^= (byte + s_val)

            # 3. 动态位移扩散 (Diffusion)
            # 这里的位移量取决于当前字节的值，极难预测
            h_val = self._rol(h_val, self._ROTATE_SEED + (byte % 5))

            # 4. 乘法雪崩效应
            h_val = (h_val * 0x5BD1E995) & 0xFFFFFFFF

        # 最终输出一个看起来像MD5但完全不是MD5的字符串
        return f"skadi-{h_val:08x}-{(h_val ^ 0xCAFEBABE):08x}"


def generate_key_for_main(eff_data, op_data):
    """对外接口"""
    cipher = ChaosCipher()

    # 将两个文件的内容拼接作为指纹源
    # 使用特定的分隔符防止碰撞
    combined_source = f"HEADER::{eff_data}::SPLIT::{op_data}::FOOTER"

    return cipher.calculate_token(combined_source)


if __name__ == "__main__":
    print("此模块为加密核心，请勿直接运行。")